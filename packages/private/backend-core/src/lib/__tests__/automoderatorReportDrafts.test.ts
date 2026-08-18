import { Buffer } from 'node:buffer';
import { beforeEach, expect, test, vi } from 'vitest';
import type { ReportDraftMessage } from '../data/automoderatorReportDrafts.js';
import {
	addReportDraftMessage,
	clearReportDraft,
	claimReportDraftToken,
	getReportDraft,
	mintReportDraftToken,
	REPORT_DRAFT_MAX_MESSAGES,
	releaseReportDraftToken,
	resolveReportDraftToken,
	splitDraft,
} from '../data/automoderatorReportDrafts.js';

// Values are Buffers because the real client is built
// `.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })` -- and because the draft is now stored through
// `RedisStore`, whose bin-rw recipe encodes to binary rather than to JSON text.
const values = new Map<string, Buffer>();
const expiries = new Map<string, number>();
let now = 1_000_000;

function live(key: string): boolean {
	const expiresAt = expiries.get(key);
	if (expiresAt !== undefined && expiresAt <= now) {
		values.delete(key);
		expiries.delete(key);
		return false;
	}

	return values.has(key);
}

vi.mock('../context.js', () => ({
	getContext: () => ({
		logger: { warn: () => undefined },
		redis: {
			async get(key: string) {
				return live(key) ? values.get(key)! : null;
			},
			async set(key: string, value: Buffer | string, options?: { expiration?: { type: 'PX'; value: number } }) {
				values.set(key, typeof value === 'string' ? Buffer.from(value) : value);
				if (options?.expiration) {
					expiries.set(key, now + options.expiration.value);
				}

				return 'OK';
			},
			// Returns the number of keys actually removed, because `claimReportDraftToken` uses exactly that to
			// decide which of two concurrent submissions owns the draft.
			async del(keys: string[] | string) {
				let removed = 0;
				for (const key of Array.isArray(keys) ? keys : [keys]) {
					if (live(key)) {
						removed++;
					}

					values.delete(key);
					expiries.delete(key);
				}

				return removed;
			},
			async exists(key: string) {
				return live(key) ? 1 : 0;
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
	values.clear();
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

test('only one of two concurrent submissions can claim a token', async () => {
	// The race this closes: both requests resolve the same draft and file it into two *different* guilds,
	// which `fileReport` has no reason to refuse because it dedupes per guild. One draft is one report.
	await addReportDraftMessage(REPORTER, message());
	const token = await mintReportDraftToken(REPORTER);

	const [first, second] = await Promise.all([claimReportDraftToken(token), claimReportDraftToken(token)]);

	expect([first, second].filter(Boolean)).toHaveLength(1);
	expect(await resolveReportDraftToken(token)).toBeNull();
});

test('a released claim can be retried', async () => {
	// A refusal or a transient database failure must cost the reporter a retry, not their draft.
	await addReportDraftMessage(REPORTER, message());
	const token = await mintReportDraftToken(REPORTER);

	expect(await claimReportDraftToken(token)).toBe(true);
	await releaseReportDraftToken(token, REPORTER);

	expect(await resolveReportDraftToken(token)).toEqual({ userId: REPORTER });
	expect(await claimReportDraftToken(token)).toBe(true);
});

test('claiming a token that was never minted fails rather than succeeding silently', async () => {
	expect(await claimReportDraftToken('6f1c2d0e-0000-4000-8000-000000000000')).toBe(false);
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

test('a draft is bound to one conversation', async () => {
	// Without this a reporter could take the subject from their DM with one account and the "context" from an
	// unrelated DM with somebody else, and that third party's private messages would be persisted onto a report
	// about the first and shown to a guild's staff. Nothing downstream can catch it.
	await addReportDraftMessage(REPORTER, message({ messageId: '1', channelId: 'dm-with-alice' }));

	const other = await addReportDraftMessage(REPORTER, message({ messageId: '2', channelId: 'dm-with-bob' }));

	expect(other.refusal).toBe('different-channel');
	expect(other.draft.messages).toHaveLength(1);
});

test('a group DM is still one conversation, so it is allowed', async () => {
	// The context menu runs in `PRIVATE_CHANNEL`, which covers group DMs -- messages from several participants
	// sharing one channel are a legitimate draft, and the card labels each author separately.
	await addReportDraftMessage(REPORTER, message({ messageId: '1' }));

	const third = await addReportDraftMessage(
		REPORTER,
		message({ messageId: '2', author: { id: '999', tag: 'third-party' } }),
	);

	expect(third.refusal).toBeNull();
	expect(third.draft.messages).toHaveLength(2);
});
