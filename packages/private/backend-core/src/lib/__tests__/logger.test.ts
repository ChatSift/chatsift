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

test('redacts refresh_token when the error is passed as pino’s bare first argument', () => {
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
