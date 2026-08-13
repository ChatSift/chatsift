/* eslint-disable no-restricted-globals, n/prefer-global/process */
import { Buffer } from 'node:buffer';
import { expect, test } from 'vitest';

// `env.ts`'s top-level `envSchema.parse(process.env)` runs the instant the module is imported, so
// `process.env` needs every required var set *before* that -- same reasoning as
// `@chatsift/bot-core`'s `testEnv.ts`. Real-shaped-enough placeholders, not meant to resemble
// anything live.
process.env['ROOT_DOMAIN'] = 'example.com';
process.env['OAUTH_DISCORD_CLIENT_ID'] = '123456789012345678';
process.env['OAUTH_DISCORD_CLIENT_SECRET'] = 'so secret';
process.env['API_URL_DEV'] = 'http://localhost:9876';
process.env['API_URL_PROD'] = 'https://api.example.com';
process.env['FRONTEND_URL_DEV'] = 'http://localhost:3000';
process.env['FRONTEND_URL_PROD'] = 'https://example.com';
process.env['ADMINS'] = '104425482757357568';
process.env['CORS'] = 'http:\\/\\/localhost:3000';
process.env['API_PORT'] = '9876';
process.env['ENCRYPTION_KEY'] = '7J7xgcVq3ZWu0RENu1riW7wJPYdqZzA1+kBRKMxhG0g=';
process.env['DATABASE_URL_DEV'] = 'postgres://user:password@localhost:5432/dbname';
process.env['DATABASE_URL_PROD'] = 'postgres://user:password@localhost:5432/dbname';
process.env['REDIS_URL_DEV'] = 'redis://localhost:6379';
process.env['REDIS_URL_PROD'] = 'redis://localhost:6379';
process.env['DISCORD_PROXY_PORT'] = '9877';
process.env['AMA_BOT_TOKEN'] = 'abcdef';
process.env['MODMAIL_BOT_TOKEN'] = 'abcdef';
process.env['SOCIAL_BOT_TOKEN'] = 'abcdef';
process.env['DOZZLE_WEBHOOK_SECRET'] = 'so secret too';
process.env['DOZZLE_WEBHOOK_DISCORD_ID'] = '123456789012345678';
process.env['DOZZLE_WEBHOOK_DISCORD_TOKEN'] = 'abcdef';
process.env['METRICS_SECRET'] = 'so secret three';

const { envSchema } = await import('../env.js');

const validEnv = { ...process.env };

test('a valid env object parses successfully', () => {
	expect(envSchema.safeParse(validEnv).success).toBe(true);
});

test('an unset or blank DISCORD_PROXY_URL means "no proxy", not a validation failure', () => {
	// docker-compose's `env_file` turns a bare `FOO=` into an empty string rather than leaving it unset, so
	// both spellings of "switched off" have to survive -- that's the production kill switch.
	for (const value of [undefined, '', '   ']) {
		const result = envSchema.safeParse({ ...validEnv, DISCORD_PROXY_URL_PROD: value });
		expect(result.success).toBe(true);
		expect(result.data?.DISCORD_PROXY_URL_PROD).toBeUndefined();
	}
});

test('a configured DISCORD_PROXY_URL still has to be a real URL', () => {
	expect(envSchema.safeParse({ ...validEnv, DISCORD_PROXY_URL_PROD: 'discord-proxy:7005' }).success).toBe(false);
	expect(envSchema.safeParse({ ...validEnv, DISCORD_PROXY_URL_PROD: 'http://discord-proxy:7005/api' }).success).toBe(
		true,
	);
});

test('ENCRYPTION_KEY rejects a 44-char string that is not valid base64 for a 32-byte key', () => {
	// Same length (44) as a real key, but not base64 at all -- would previously pass `.length(44)`.
	const result = envSchema.safeParse({ ...validEnv, ENCRYPTION_KEY: '!'.repeat(44) });
	expect(result.success).toBe(false);
});

test('ENCRYPTION_KEY rejects valid base64 that decodes to the wrong byte length', () => {
	// 44 base64 chars, but encodes 33 bytes instead of 32.
	const thirtyThreeBytesBase64 = Buffer.alloc(33, 1).toString('base64');
	const result = envSchema.safeParse({ ...validEnv, ENCRYPTION_KEY: thirtyThreeBytesBase64 });
	expect(result.success).toBe(false);
});

test('MODMAIL_INSTANCE_ID is optional', () => {
	const { MODMAIL_INSTANCE_ID, ...rest } = validEnv;
	expect(envSchema.safeParse(rest).success).toBe(true);
});

test('MODMAIL_INSTANCE_ID rejects an empty string', () => {
	const result = envSchema.safeParse({ ...validEnv, MODMAIL_INSTANCE_ID: '' });
	expect(result.success).toBe(false);
});

test('MODMAIL_INSTANCE_ID rejects a whitespace-only string', () => {
	const result = envSchema.safeParse({ ...validEnv, MODMAIL_INSTANCE_ID: '   ' });
	expect(result.success).toBe(false);
});

test('MODMAIL_INSTANCE_ID trims surrounding whitespace off an otherwise valid value', () => {
	const result = envSchema.safeParse({ ...validEnv, MODMAIL_INSTANCE_ID: '  partner-a  ' });
	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.MODMAIL_INSTANCE_ID).toBe('partner-a');
	}
});
