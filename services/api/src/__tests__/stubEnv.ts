import process from 'node:process';

/**
 * Fills `process.env` with values that satisfy `@chatsift/backend-core`'s env schema, which
 * `lib/env.ts` parses eagerly at module-load time (`ENV = envSchema.parse(process.env)`). Anything that
 * transitively imports `context.js` -- which in `services/api` is very nearly everything -- therefore
 * can't even be *imported* in a unit test without this having run first.
 *
 * Call it from inside a `vi.mock('@chatsift/backend-core', ...)` factory, which vitest hoists above the
 * imports, so the assignments land before the real module is evaluated:
 *
 * ```ts
 * vi.mock('@chatsift/backend-core', async (importActual) => {
 *   const { stubTestEnv } = await import('../../__tests__/stubEnv.js');
 *   stubTestEnv();
 *   return importActual();
 * });
 * ```
 *
 * None of these values are reachable by anything: no test opens a socket to the database, redis, or
 * Discord. They only have to be well-formed enough for the schema (the encryption key in particular has
 * to be real base64 of the right length).
 *
 * Not a `.test.ts` file on purpose -- vitest's default `include` only collects `*.test.*`/`*.spec.*`, so
 * this sits in `__tests__` without being collected as a suite of its own.
 */
export function stubTestEnv(): void {
	process.env['ROOT_DOMAIN'] = '';
	process.env['OAUTH_DISCORD_CLIENT_ID'] = '123456789012345678';
	process.env['OAUTH_DISCORD_CLIENT_SECRET'] = 'so secret';
	process.env['API_URL_DEV'] = 'http://localhost:9876';
	process.env['API_URL_PROD'] = 'https://api.example.com';
	process.env['FRONTEND_URL_DEV'] = 'http://localhost:3000';
	process.env['FRONTEND_URL_PROD'] = 'https://example.com';
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
}
