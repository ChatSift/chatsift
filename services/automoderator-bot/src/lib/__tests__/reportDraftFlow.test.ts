import type { Logger } from '@chatsift/backend-core';
import type { APIMessage, APIUser } from '@discordjs/core';
import { beforeEach, expect, test, vi } from 'vitest';

const addReportDraftMessage = vi.fn();
const getReportDraft = vi.fn();
const mintReportDraftToken = vi.fn();

// `backend-core` parses its env schema at import time, which throws in a unit test -- so the whole module is
// stubbed, the same way `reportFlow.test.ts` does it. The draft store itself has its own tests over a fake
// redis in `backend-core`; what matters here is which line the reporter is shown for each outcome, because
// that copy is the entire user interface of this feature.
vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({ service: { client: { api: {} } } }),
	publishRealtimeInvalidate: async () => undefined,
	addReportDraftMessage,
	getReportDraft,
	mintReportDraftToken,
	REPORT_DRAFT_MAX_MESSAGES: 6,
	REPORT_DRAFT_TTL_MINUTES: 30,
	REPORT_DRAFT_TOKEN_TTL_MINUTES: 10,
	reportDraftLink: (token: string) => `https://example.com/automoderator/report/${token}`,
	splitDraft: (draft: { messages: { author: { id: string } }[] }, reporterId: string) =>
		draft.messages.some((entry) => entry.author.id !== reporterId) ? { subject: {}, contextMessages: [] } : null,
}));

const { addToReportDraft, snapshotDraftMessage, submitReportDraft } = await import('../reportDraftFlow.js');

const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Logger;

const REPORTER = { id: '55', username: 'reporter', discriminator: '0' } as APIUser;
const TARGET = { id: '2', username: 'target', discriminator: '0' } as APIUser;

function message(overrides: Partial<APIMessage> = {}): APIMessage {
	return {
		id: '100',
		channel_id: 'dm',
		author: TARGET,
		content: 'something rude',
		attachments: [],
		embeds: [],
		timestamp: '2026-08-18T00:00:00.000Z',
		...overrides,
	} as APIMessage;
}

beforeEach(() => {
	addReportDraftMessage.mockReset();
	getReportDraft.mockReset();
	mintReportDraftToken.mockReset();
});

test('a snapshot carries the author and timestamp a guild report derives instead', () => {
	// A DM draft can include the reporter's own replies, so "who wrote this" stops being derivable from the
	// report's target the way it is for a guild report.
	const snapshot = snapshotDraftMessage(message(), TARGET);

	expect(snapshot).toMatchObject({
		messageId: '100',
		channelId: 'dm',
		author: { id: '2' },
		content: 'something rude',
		timestamp: '2026-08-18T00:00:00.000Z',
	});
});

test('an empty message body snapshots as null rather than an empty string', () => {
	// The card branches on "was there text at all", and an empty string would render an empty code block.
	expect(snapshotDraftMessage(message({ content: '' }), TARGET).content).toBeNull();
});

test('a bot message is refused before anything is written', async () => {
	const result = await addToReportDraft(
		{ message: message({ author: { ...TARGET, bot: true } as APIUser }), reporter: REPORTER },
		logger,
	);

	expect(result).toContain('Bot messages');
	expect(addReportDraftMessage).not.toHaveBeenCalled();
});

test('adding tells the reporter what is in the draft and what to run next', async () => {
	addReportDraftMessage.mockResolvedValue({ draft: { messages: [{}, {}] }, refusal: null });

	const result = await addToReportDraft({ message: message(), reporter: REPORTER }, logger);

	expect(result).toContain('2 messages');
	expect(result).toContain('/submit-report');
});

test('each refusal gets its own line rather than a generic failure', async () => {
	for (const [refusal, expected] of [
		['duplicate', 'already in your report draft'],
		['different-channel', 'only cover one conversation'],
		['full', 'at most 6 messages'],
	] as const) {
		addReportDraftMessage.mockResolvedValue({ draft: { messages: [{}] }, refusal });
		expect(await addToReportDraft({ message: message(), reporter: REPORTER }, logger)).toContain(expected);
	}
});

test('a storage failure reads as try again rather than as success', async () => {
	// The reporter is mid-incident; telling them it worked when it did not is the worst outcome here.
	addReportDraftMessage.mockRejectedValue(new Error('redis is down'));

	const result = await addToReportDraft({ message: message(), reporter: REPORTER }, logger);

	expect(result).toContain('went wrong');
	expect(vi.mocked(logger.error)).toHaveBeenCalled();
});

test('submitting with no draft explains how to start one', async () => {
	getReportDraft.mockResolvedValue(null);

	const result = await submitReportDraft(REPORTER, logger);

	expect(result).toContain('Add to Report Draft');
	expect(mintReportDraftToken).not.toHaveBeenCalled();
});

test('a draft of only the reporter own messages is caught before the OAuth round trip', async () => {
	// They are one context-menu click from fixing it here; finding out after logging in on the website would be
	// a worse place to learn it.
	getReportDraft.mockResolvedValue({ messages: [{ author: { id: REPORTER.id } }] });

	const result = await submitReportDraft(REPORTER, logger);

	expect(result).toContain('nobody to report');
	expect(mintReportDraftToken).not.toHaveBeenCalled();
});

test('submitting hands back a link, the deadline, and what happens next', async () => {
	getReportDraft.mockResolvedValue({ messages: [{ author: { id: TARGET.id } }] });
	mintReportDraftToken.mockResolvedValue('tok-1');

	const result = await submitReportDraft(REPORTER, logger);

	expect(result).toContain('https://example.com/automoderator/report/tok-1');
	expect(result).toContain('10 minutes');
	// The picker is deliberately vague about *why* a server is missing; the promise made here has to match it.
	expect(result).toContain('only servers you share');
});
