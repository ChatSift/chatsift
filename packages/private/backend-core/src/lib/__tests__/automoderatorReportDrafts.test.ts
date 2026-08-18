import { Buffer } from 'node:buffer';
import { beforeEach, expect, test, vi } from 'vitest';
import type { ReportDraftMessage } from '../data/automoderatorReportDrafts.js';
import {
	addReportDraftMessage,
	clearReportDraft,
	consumeReportDraftToken,
	getReportDraft,
	mintReportDraftToken,
	REPORT_DRAFT_MAX_MESSAGES,
	resolveReportDraftToken,
	splitDraft,
} from '../data/automoderatorReportDrafts.js';

const strings = new Map<string, string>();
const expiries = new Map<string, number>();
let now = 1_000_000;

function live(key: string): boolean {
	const expiresAt = expiries.get(key);
	if (expiresAt !== undefined && expiresAt <= now) {
		strings.delete(key);
		expiries.delete(key);
		return false;
	}

	return strings.has(key);
}

// The real client is built `.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })`, so `get` hands back a
// Buffer rather than a string -- this fake does the same, since a reader that assumed strings would pass
// against a naive fake and then throw in production.
vi.mock('../context.js', () => ({
	getContext: () => ({
		redis: {
			async get(key: string) {
				return live(key) ? Buffer.from(strings.get(key)!) : null;
			},
			async set(key: string, value: string, options?: { expiration?: { type: 'PX'; value: number } }) {
				strings.set(key, value);
				if (options?.expiration) {
					expiries.set(key, now + options.expiration.value);
				}

				return 'OK';
			},
			async del(key: string) {
				strings.delete(key);
				expiries.delete(key);
			},
			async pExpire(key: string, ttl: number) {
				if (!live(key)) {
					return 0;
				}

				expiries.set(key, now + ttl);
				return 1;
			},
		},
	}),
}));

const REPORTER = '55';
const TARGET = '2';

function message(overrides: Partial<ReportDraftMessage> = {}): ReportDraftMessage {
	return {
		messageId: '100',
		channelId: 'dm',
		author: { id: TARGET, tag: 'target' },
		content: 'something rude',
		imageUrl: null,
		timestamp: '2026-08-18T00:00:00.000Z',
		...overrides,
	};
}

beforeEach(() => {
	strings.clear();
	expiries.clear();
	now = 1_000_000;
});

test('a draft accumulates messages in the order they were added', async () => {
	// Never re-sorted chronologically: which message the reporter leads with is part of what they are saying.
	await addReportDraftMessage(REPORTER, message({ messageId: '1' }));
	await addReportDraftMessage(REPORTER, message({ messageId: '2' }));

	const draft = await getReportDraft(REPORTER);
	expect(draft!.messages.map((entry) => entry.messageId)).toEqual(['1', '2']);
});

test('the same message twice is refused rather than duplicated', async () => {
	await addReportDraftMessage(REPORTER, message({ messageId: '1' }));
	const second = await addReportDraftMessage(REPORTER, message({ messageId: '1' }));

	expect(second.refusal).toBe('duplicate');
	expect(second.draft.messages).toHaveLength(1);
});

test('a draft stops accepting messages at the cap', async () => {
	// The cap is what keeps the card inside Discord's 6000-character-per-message embed budget once every
	// message renders with its own author and image.
	for (let index = 0; index < REPORT_DRAFT_MAX_MESSAGES; index++) {
		const result = await addReportDraftMessage(REPORTER, message({ messageId: String(index) }));
		expect(result.refusal).toBeNull();
	}

	const overflow = await addReportDraftMessage(REPORTER, message({ messageId: 'extra' }));
	expect(overflow.refusal).toBe('full');
	expect(overflow.draft.messages).toHaveLength(REPORT_DRAFT_MAX_MESSAGES);
});

test('adding a message renews the draft, so building one slowly cannot time it out', async () => {
	await addReportDraftMessage(REPORTER, message({ messageId: '1' }));

	// Twenty minutes later -- past nothing yet, but well into the window.
	now += 20 * 60 * 1_000;
	await addReportDraftMessage(REPORTER, message({ messageId: '2' }));

	// Another twenty. The first write's expiry has passed; the second's has not.
	now += 20 * 60 * 1_000;
	expect(await getReportDraft(REPORTER)).not.toBeNull();
});

test('a draft expires on its own once untouched', async () => {
	await addReportDraftMessage(REPORTER, message());

	now += 31 * 60 * 1_000;
	expect(await getReportDraft(REPORTER)).toBeNull();
});

test('a token names the draft rather than carrying it', async () => {
	// The token is not a bearer credential: it identifies whose draft to read, and the route that redeems it
	// re-checks that against the logged-in session.
	await addReportDraftMessage(REPORTER, message());
	const token = await mintReportDraftToken(REPORTER);

	expect(await resolveReportDraftToken(token)).toEqual({ userId: REPORTER });
});

test('minting a token renews the draft, so the link cannot outlive what it points at', async () => {
	await addReportDraftMessage(REPORTER, message());

	now += 25 * 60 * 1_000;
	await mintReportDraftToken(REPORTER);

	// The draft's original 30-minute window would have closed by now; the mint pushed it out.
	now += 10 * 60 * 1_000;
	expect(await getReportDraft(REPORTER)).not.toBeNull();
});

test('a token expires well before its draft does', async () => {
	await addReportDraftMessage(REPORTER, message());
	const token = await mintReportDraftToken(REPORTER);

	now += 11 * 60 * 1_000;

	// The reporter can still mint another from the same draft, which is why the shorter window is affordable.
	expect(await resolveReportDraftToken(token)).toBeNull();
	expect(await getReportDraft(REPORTER)).not.toBeNull();
});

test('a consumed token cannot file a second report', async () => {
	await addReportDraftMessage(REPORTER, message());
	const token = await mintReportDraftToken(REPORTER);

	await consumeReportDraftToken(token);
	expect(await resolveReportDraftToken(token)).toBeNull();
});

test('clearing a draft leaves nothing for the next submission to re-file', async () => {
	await addReportDraftMessage(REPORTER, message());
	await clearReportDraft(REPORTER);

	expect(await getReportDraft(REPORTER)).toBeNull();
});

test('the subject is the first message the target wrote, not simply the first message', () => {
	// The parent row's `target_id`/`target_tag` describe whoever wrote the snapshot on it, and the card renders
	// that pairing as its author line -- so a draft opening with the reporter's own reply must not headline the
	// report with a message the reporter wrote.
	const split = splitDraft(
		{
			messages: [
				message({ messageId: '1', author: { id: REPORTER, tag: 'reporter' }, content: 'please stop' }),
				message({ messageId: '2', content: 'no' }),
			],
		},
		REPORTER,
	);

	expect(split!.subject.messageId).toBe('2');
	expect(split!.target).toEqual({ id: TARGET, tag: 'target' });
});

test("every other message stays context, in the reporter's order, with its own author", () => {
	const split = splitDraft(
		{
			messages: [
				message({ messageId: '1' }),
				message({ messageId: '2', author: { id: REPORTER, tag: 'reporter' } }),
				message({ messageId: '3' }),
			],
		},
		REPORTER,
	);

	expect(split!.subject.messageId).toBe('1');
	expect(split!.contextMessages.map((entry) => entry.messageId)).toEqual(['2', '3']);
	// The whole reason `automoderator_report_messages` carries an author the parent row never needs.
	expect(split!.contextMessages[0]!.author).toEqual({ id: REPORTER, tag: 'reporter' });
});

test("a draft of nothing but the reporter's own messages has nobody to report", () => {
	expect(
		splitDraft(
			{
				messages: [
					message({ messageId: '1', author: { id: REPORTER, tag: 'reporter' } }),
					message({ messageId: '2', author: { id: REPORTER, tag: 'reporter' } }),
				],
			},
			REPORTER,
		),
	).toBeNull();
});

test('a single-message draft produces no context rows at all', () => {
	const split = splitDraft({ messages: [message()] }, REPORTER);

	expect(split!.subject.messageId).toBe('100');
	expect(split!.contextMessages).toHaveLength(0);
});
