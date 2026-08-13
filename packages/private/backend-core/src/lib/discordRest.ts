import { getContext } from './context.js';

/**
 * Structurally a `Partial<RESTOptions>`, spelled out here so `backend-core` doesn't have to take a dependency
 * on `@discordjs/rest` for two fields.
 */
export interface DiscordRestProxyOptions {
	api?: string;
	globalRequestsPerSecond?: number;
}

/**
 * `REST` options that route a client through `services/discord-proxy`, or an empty object when no proxy is
 * configured (see `DISCORD_PROXY_URL_DEV`/`_PROD` in env.ts -- unset means "go straight to Discord").
 *
 * Spread this into every `new REST(...)` that carries a *bot* token. The one client that must not use it is
 * the API's OAuth client: those requests carry a per-user `Bearer` token, and the proxy keys its rate limit
 * state by `Authorization`, so proxying them would mean one `REST` instance per dashboard visitor.
 */
export function discordRestProxyOptions(): DiscordRestProxyOptions {
	const { DISCORD_PROXY_URL } = getContext();
	if (!DISCORD_PROXY_URL) {
		return {};
	}

	return {
		api: DISCORD_PROXY_URL,
		// The proxy is the only accountant now, and it strips Discord's rate limit headers on the way back, so
		// a client's own bucket state would be built from nothing anyway. This disables the one piece of
		// client-side throttling that *isn't* header-driven -- the local 50/s global counter, which would
		// otherwise have each process independently rationing an allowance it no longer owns.
		globalRequestsPerSecond: Number.POSITIVE_INFINITY,
	};
}
