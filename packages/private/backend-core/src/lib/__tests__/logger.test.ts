import type { Buffer } from 'node:buffer';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { expect, test, vi } from 'vitest';
import { createLoggerOptions } from '../logger.js';

// `logger.ts` imports `./env.js`, which parses `process.env` against a strict schema at module load time --
// mock it out (vitest hoists this above the static import above) so this test doesn't need every real env var
// the running service normally provides.
vi.mock('../env.js', () => ({ ENV: { IS_PRODUCTION: false } }));

/**
 * Mirrors the shape `@discordjs/rest` actually throws: `DiscordAPIError`/`HTTPError` carry the literal request
 * body (including OAuth `client_secret`/`refresh_token`) on `.requestBody.json`.
 */
class FakeDiscordRestError extends Error {
	public requestBody: { json: Record<string, unknown> };

	public constructor(json: Record<string, unknown>) {
		super('Discord API error');
		this.requestBody = { json };
	}
}

function createCapturingLogger() {
	const chunks: string[] = [];
	const stream = new Writable({
		write(chunk: Buffer, _encoding, callback) {
			chunks.push(chunk.toString('utf8'));
			callback();
		},
	});

	const logger = pino(createLoggerOptions('test'), stream);
	return { logger, output: () => chunks.join('\n') };
}

test('redacts client_secret when the error is logged under an explicit `err` key', () => {
	const { logger, output } = createCapturingLogger();
	const error = new FakeDiscordRestError({
		client_id: 'some-client-id',
		client_secret: 'SUPER_SECRET_CLIENT_SECRET',
		grant_type: 'authorization_code',
	});

	logger.error({ err: error }, 'error exchanging discord oauth code');

	expect(output()).not.toContain('SUPER_SECRET_CLIENT_SECRET');
	expect(output()).toContain('[REDACTED]');
});

test("redacts refresh_token when the error is passed as pino's bare first argument", () => {
	const { logger, output } = createCapturingLogger();
	const error = new FakeDiscordRestError({
		grant_type: 'refresh_token',
		refresh_token: 'SUPER_SECRET_REFRESH_TOKEN',
	});

	// pino auto-nests an `Error` passed as the first arg under `err`, same as `app.ts`'s `logger.error(boom, ...)`.
	logger.error(error, 'error refreshing discord access token');

	expect(output()).not.toContain('SUPER_SECRET_REFRESH_TOKEN');
	expect(output()).toContain('[REDACTED]');
});

// The exact payload `@discordjs/rest` emits on `RESTEvents.RateLimited` for a webhook execution -- both
// `url` and `majorParameter` embed the webhook token, which is the credential for that webhook.
const WEBHOOK_TOKEN = 'KZ5qeLObBjWHlpq5UGEcI0JNhYveaX7-mcz2Nk2oFLPD8FTxsUc8blJHUkEwgAhT_l3U';
const RATE_LIMIT_INFO = {
	global: false,
	hash: '3d2712a9e4fe17cc9d3fed4a8e672e5f',
	limit: 5,
	majorParameter: `1529194815022174348/${WEBHOOK_TOKEN}`,
	method: 'POST',
	retryAfter: 1_930,
	route: '/webhooks/:id/:token',
	scope: 'user',
	sublimitTimeout: 0,
	timeToReset: 1_930,
	url: `https://discord.com/api/v10/webhooks/1529194815022174348/${WEBHOOK_TOKEN}`,
};

test('redacts the webhook token out of a rate limit payload while keeping the rest of the route', () => {
	const { logger, output } = createCapturingLogger();

	logger.warn(RATE_LIMIT_INFO, 'Hit a Discord REST rate limit');

	expect(output()).not.toContain(WEBHOOK_TOKEN);
	expect(output()).toContain('https://discord.com/api/v10/webhooks/1529194815022174348/[REDACTED]');
	expect(output()).toContain('1529194815022174348/[REDACTED]');
	// Everything that made the line worth logging survives.
	expect(output()).toContain('3d2712a9e4fe17cc9d3fed4a8e672e5f');
	expect(output()).toContain('/webhooks/:id/:token');
});

test('redacts route tokens off an error thrown by @discordjs/rest', () => {
	const { logger, output } = createCapturingLogger();
	// `RateLimitError`/`DiscordAPIError`/`HTTPError` all set `url` (and the first `majorParameter`) as own
	// enumerable properties, so pino's error serializer carries them into the log line.
	const error = Object.assign(new Error('rate limited'), {
		url: `https://discord.com/api/v10/webhooks/1529194815022174348/${WEBHOOK_TOKEN}/messages/@original`,
		majorParameter: `1529194815022174348/${WEBHOOK_TOKEN}`,
	});

	logger.error({ err: error }, 'Failed to proxy a request to Discord');

	expect(output()).not.toContain(WEBHOOK_TOKEN);
	// The sub-route sits past the token and has to survive it.
	expect(output()).toContain('/webhooks/1529194815022174348/[REDACTED]/messages/@original');
});

test("redacts the interaction token out of the proxy's fullRoute", () => {
	const { logger, output } = createCapturingLogger();

	logger.error(
		{ fullRoute: `/interactions/1529194815022174348/${WEBHOOK_TOKEN}/callback` },
		'Failed to proxy a request to Discord',
	);

	expect(output()).not.toContain(WEBHOOK_TOKEN);
	expect(output()).toContain('/interactions/1529194815022174348/[REDACTED]/callback');
});

test('leaves a url carrying no route token alone', () => {
	const { logger, output } = createCapturingLogger();
	const url = 'https://cdn.discordapp.com/attachments/1529194815022174348/1529194815022174349/file.png?ex=1';

	logger.warn({ url }, 'Failed to fetch media for relay, falling back to a link');

	expect(output()).toContain(url);
	expect(output()).not.toContain('[REDACTED]');
});
