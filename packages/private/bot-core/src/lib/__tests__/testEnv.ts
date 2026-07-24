/* eslint-disable no-restricted-globals, n/prefer-global/process */

/**
 * `@chatsift/backend-core`'s `env.ts` parses `process.env` against a strict Zod schema at module load time, so
 * `vi.mock('@chatsift/backend-core', async (importActual) => ...)` factories that call the real `importActual()`
 * need every required var set first, or the import throws before the mock factory can even return. Values are
 * arbitrary placeholders shaped to pass the schema, not meant to resemble anything real.
 */
export function stubBackendCoreEnv(): void {
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
	process.env['AMA_BOT_TOKEN'] = 'abcdef';
	process.env['MODMAIL_BOT_TOKEN'] = 'abcdef';
	process.env['DOZZLE_WEBHOOK_SECRET'] = 'so secret too';
	process.env['DOZZLE_WEBHOOK_DISCORD_ID'] = '123456789012345678';
	process.env['DOZZLE_WEBHOOK_DISCORD_TOKEN'] = 'abcdef';
}
