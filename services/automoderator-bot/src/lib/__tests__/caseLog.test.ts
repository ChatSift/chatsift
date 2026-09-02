import type { Logger } from '@chatsift/backend-core';
import type { AutomoderatorCases } from '@chatsift/db';
import { beforeEach, expect, test, vi } from 'vitest';
import { dispatchCaseLog } from '../caseLog.js';

const decrypt = vi.fn();
const execute = vi.fn();
const editMessage = vi.fn();

let webhookRows: unknown[] = [];

vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	decrypt: (data: string) => decrypt(data) as string,
	getContext: () => ({
		db: () => webhookRows,
		service: { client: { api: { webhooks: { execute, editMessage } } } },
	}),
	publishRealtimeInvalidate: vi.fn(),
}));

// The embed's contents are `guildLogFormat.test.ts`'s subject; here it only has to exist.
vi.mock('../caseFormat.js', () => ({ buildCaseEmbed: () => ({ description: 'case' }) }));

const WEBHOOK = {
	guildId: '1',
	logType: 'MOD',
	channelId: '2',
	webhookId: '3',
	webhookToken: 'ciphertext',
	threadId: null,
};

const CASE = { id: 1, caseId: 1, guildId: '1', refId: null, targetId: '4', logMessageId: null } as AutomoderatorCases;

const logger = { error: vi.fn(), warn: vi.fn() } as unknown as Logger;

beforeEach(() => {
	webhookRows = [WEBHOOK];
	decrypt.mockReset().mockReturnValue('token');
	execute.mockReset();
	editMessage.mockReset();
	vi.mocked(logger.error).mockReset();
});

// The regression this file exists for: the case is already filed and the punishment already applied by the
// time the log is dispatched, so a token that cannot be read -- a rotated `ENCRYPTION_KEY`, or a row written
// by something that skipped `encrypt` -- has to cost the guild its log entry and nothing else. It used to
// escape and fail the whole mod command, leaving the moderator with an error over work that had succeeded.
test('an undecryptable webhook token does not escape', async () => {
	decrypt.mockImplementation(() => {
		throw new Error('Unsupported state or unable to authenticate data');
	});

	await expect(dispatchCaseLog(CASE, logger)).resolves.toBeUndefined();

	expect(execute).not.toHaveBeenCalled();
	expect(logger.error).toHaveBeenCalled();
});

test('a guild with no mod log never reaches the token at all', async () => {
	webhookRows = [];

	await expect(dispatchCaseLog(CASE, logger)).resolves.toBeUndefined();

	expect(decrypt).not.toHaveBeenCalled();
});
