import type { Logger } from '@chatsift/backend-core';
import type { AutomoderatorLogWebhooks } from '@chatsift/db';
import { beforeEach, expect, test, vi } from 'vitest';
import { dispatchLog, LOG_TYPE, logAvatarUrl } from '../guildLog.js';

const execute = vi.fn();

let frontendUrl = 'https://example.com';

vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	decrypt: () => 'token',
	getContext: () => ({
		FRONTEND_URL: frontendUrl,
		db: () => [],
		service: { client: { api: { webhooks: { execute } } } },
	}),
}));

// The action seam is `actionExecutor.test.ts`'s subject; here it only has to let the call through, so that what
// this file asserts is the payload `dispatchLog` builds rather than dry-run resolution.
vi.mock('../actionExecutor.js', () => ({
	executeAction: async (request: { execute(): Promise<void> }) => {
		await request.execute();
		return { suppressed: false };
	},
}));

const logger = { error: vi.fn(), warn: vi.fn() } as unknown as Logger;

beforeEach(() => {
	execute.mockReset();
	frontendUrl = 'https://example.com';
});

// The avatars are per-message (#379), so the mapping is re-derived on every single dispatch rather than being
// frozen into the webhook at creation. That makes a wrong entry here a wrong icon in every guild at once,
// which is worth pinning down.
test('every log type maps to its own avatar', () => {
	expect(logAvatarUrl(LOG_TYPE.MOD)).toBe('https://example.com/assets/automoderator-logs/mod.png');
	expect(logAvatarUrl(LOG_TYPE.FILTER)).toBe('https://example.com/assets/automoderator-logs/filter.png');
	expect(logAvatarUrl(LOG_TYPE.MESSAGE)).toBe('https://example.com/assets/automoderator-logs/message.png');
	expect(logAvatarUrl(LOG_TYPE.USER)).toBe('https://example.com/assets/automoderator-logs/user.png');
});

// `FRONTEND_URL` comes off the environment unnormalized and may carry a trailing slash -- the reason
// `dashboardLinks.ts` strips one by hand. `new URL` with an absolute path collapses it instead, and this is
// what keeps that from silently becoming a doubled slash if the helper is ever rewritten as concatenation.
test('a trailing slash on FRONTEND_URL does not double up', () => {
	frontendUrl = 'https://example.com/';

	expect(logAvatarUrl(LOG_TYPE.MOD)).toBe('https://example.com/assets/automoderator-logs/mod.png');
});

test('a dispatch carries the avatar for its own log type', async () => {
	const webhook = {
		guildId: '1',
		logType: LOG_TYPE.MESSAGE,
		channelId: '2',
		webhookId: '3',
		webhookToken: 'ciphertext',
		threadId: null,
	} as AutomoderatorLogWebhooks;

	await dispatchLog(webhook, { embeds: [{ description: 'deleted' }], source: 'observer' }, logger);

	expect(execute).toHaveBeenCalledWith(
		'3',
		'token',
		expect.objectContaining({ avatar_url: 'https://example.com/assets/automoderator-logs/message.png' }),
	);
});
