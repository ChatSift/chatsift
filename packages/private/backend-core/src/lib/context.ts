import type { Database } from '@chatsift/db';
import type { Logger } from 'pino';
import { ENV } from './env.js';
import type { createRedis } from './redis.js';

/**
 * Empty base for service-specific context properties, namespaced under `Context.service` — each service augments
 * this via declaration merging (e.g. `services/ama-bot` adds `client`, see `lib/client.ts`) rather than
 * backend-core needing to know about every dependency each service happens to hang off its context.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type -- intentionally empty; augmented per-service via declaration merging
export interface ContextService {}

export interface Context {
	API_URL: string;
	BCRYPT_SALT_ROUNDS: number;
	/**
	 * Base URL every `REST` client in this process should talk to, or `null` to talk to Discord directly.
	 * See `DISCORD_PROXY_URL_DEV`/`_PROD` in env.ts for why "unset" is a supported, meaningful state.
	 */
	DISCORD_PROXY_URL: string | null;
	FRONTEND_URL: string;
	UP_SINCE: number;

	/**
	 * `postgres.js` raw SQL client (docs/adr/0002-db-stack.md).
	 */
	db: Database;
	env: typeof ENV;
	logger: Logger;
	redis: Awaited<ReturnType<typeof createRedis>>;
	service: ContextService;
}

let context: Context | null = null;

export function initContext(given: Pick<Context, 'db' | 'logger' | 'redis'>): void {
	if (context !== null) {
		throw new Error('Context has already been initialized');
	}

	context = {
		API_URL: ENV.IS_PRODUCTION ? ENV.API_URL_PROD : ENV.API_URL_DEV,
		BCRYPT_SALT_ROUNDS: 14,
		DISCORD_PROXY_URL: (ENV.IS_PRODUCTION ? ENV.DISCORD_PROXY_URL_PROD : ENV.DISCORD_PROXY_URL_DEV) ?? null,
		FRONTEND_URL: ENV.IS_PRODUCTION ? ENV.FRONTEND_URL_PROD : ENV.FRONTEND_URL_DEV,
		UP_SINCE: Date.now(),

		env: ENV,
		service: {},
		...given,
	};
}

export function getContext(): Context {
	if (!context) {
		throw new Error('Context has not been initialized yet');
	}

	return context;
}

/**
 * Sets a service-specific value under `Context.service` after `initContext` has already run. For singletons that
 * can only be constructed once the context they themselves depend on already exists (e.g. ama-bot's `client`,
 * which needs `getContext().env.AMA_BOT_TOKEN` to build its `REST` client in the first place).
 */
export function setServiceValue<Key extends keyof ContextService>(key: Key, value: ContextService[Key]): void {
	if (!context) {
		throw new Error('Context has not been initialized yet');
	}

	context.service[key] = value;
}
