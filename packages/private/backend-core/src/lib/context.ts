import { URL } from 'node:url';
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
	/**
	 * The API's own base URL when it is acting for `unban.app` (#232 P3) -- `api.unban.app` in production, and
	 * the same `localhost` origin as `API_URL` in dev. Distinct from `API_URL` because every appeals cookie is
	 * pinned to `APPEALS_ROOT_DOMAIN`, and a cookie can only be set by a host under the domain it names.
	 */
	APPEALS_API_URL: string;
	/**
	 * `unban.app` (#232). Resolved the same way `FRONTEND_URL` is, and kept beside it rather than read from
	 * `env` at each call site so the `IS_PRODUCTION` branch exists once for both frontends.
	 */
	APPEALS_FRONTEND_URL: string;
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

/**
 * Fails the boot when an API base URL is served from a host that cannot write the cookies pinned to its own
 * `*_ROOT_DOMAIN`. A browser silently discards a `Set-Cookie` whose `Domain` does not cover the host that sent
 * it (RFC 6265 5.3.6), so getting this pair wrong does not break loudly -- it breaks as a login that always
 * answers `400 bad state`, which is precisely how `unban.app` shipped: `APPEALS_ROOT_DOMAIN=unban.app` against
 * an API on `api.automoderator.app`. Cheap to assert, invisible otherwise.
 *
 * Production only: `cookieWithDomain`/`appealsCookieWithDomain` both leave `domain` unset when `IS_PRODUCTION`
 * is false, which is why dev runs happily with `localhost:7004` against these same two domains.
 */
function assertCookieDomainReachable(label: string, apiURL: string, rootDomain: string): void {
	if (!ENV.IS_PRODUCTION) {
		return;
	}

	const { hostname } = new URL(apiURL);
	if (hostname !== rootDomain && !hostname.endsWith(`.${rootDomain}`)) {
		throw new Error(
			`${label}: the API is served from ${hostname}, which is not under ${rootDomain} -- every cookie pinned ` +
				`to that domain would be discarded by the browser, so no session could ever be established. Give the ` +
				`API a hostname under ${rootDomain} (see build/caddy/Caddyfile) rather than relaxing the cookie.`,
		);
	}
}

export function initContext(given: Pick<Context, 'db' | 'logger' | 'redis'>): void {
	if (context !== null) {
		throw new Error('Context has already been initialized');
	}

	assertCookieDomainReachable('API_URL_PROD/ROOT_DOMAIN', ENV.API_URL_PROD, ENV.ROOT_DOMAIN);
	assertCookieDomainReachable(
		'APPEALS_API_URL_PROD/APPEALS_ROOT_DOMAIN',
		ENV.APPEALS_API_URL_PROD,
		ENV.APPEALS_ROOT_DOMAIN,
	);

	context = {
		API_URL: ENV.IS_PRODUCTION ? ENV.API_URL_PROD : ENV.API_URL_DEV,
		APPEALS_API_URL: ENV.IS_PRODUCTION ? ENV.APPEALS_API_URL_PROD : ENV.APPEALS_API_URL_DEV,
		APPEALS_FRONTEND_URL: ENV.IS_PRODUCTION ? ENV.APPEALS_FRONTEND_URL_PROD : ENV.APPEALS_FRONTEND_URL_DEV,
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
