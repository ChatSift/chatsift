import { getContext, getInstanceForGuild, type BotId, type Instance } from '@chatsift/backend-core';
import type { Snowflake } from '@discordjs/core';
import { API } from '@discordjs/core';
import { REST, RESTEvents } from '@discordjs/rest';
import type { MeGuild } from './me.js';

function createRest(): REST {
	const rest = new REST({ version: '10' });

	rest.on(RESTEvents.RateLimited, (rateLimitInfo) => {
		getContext().logger.warn(rateLimitInfo, 'Hit a Discord REST rate limit');
	});

	return rest;
}

const oauthREST = createRest();
export const discordAPIOAuth = new API(oauthREST);

const amaREST = createRest().setToken(getContext().env.AMA_BOT_TOKEN);
export const discordAPIAma = new API(amaREST);

const modmailREST = createRest().setToken(getContext().env.MODMAIL_BOT_TOKEN);
export const discordAPIModmail = new API(modmailREST);

// Webhook execution is authed by the id/token in the URL itself, no bot token needed
const webhookREST = createRest();
export const discordAPIWebhook = new API(webhookREST);

export const APIMapping: Record<BotId, API> = {
	AMA: discordAPIAma,
	MODMAIL: discordAPIModmail,
};

// Lazily built, kept for the life of the process -- a custom instance's token never changes without a
// redeploy (the registry refresh only ever adds/removes rows, see `instances.ts`), so there's no need to
// recreate the `REST`/`API` pair on every refresh tick, only the first time a guild owned by that instance
// is actually touched.
const instanceAPIs = new Map<string, API>();

function apiForInstance(instance: Instance): API {
	let api = instanceAPIs.get(instance.id);
	if (!api) {
		api = new API(createRest().setToken(instance.token));
		instanceAPIs.set(instance.id, api);
	}

	return api;
}

export interface ResolvedGuildAPI {
	/**
	 * The `API` client to use for this `(botId, guildId)` pair.
	 */
	api: API;
	/**
	 * `'public'`, or the owning custom instance's id -- a second cache-key dimension for anything that caches
	 * Discord data per `(botId, guildId)` (`guildDataCache.ts`, `discordApplication.ts`). Folding this into a
	 * cache key means a guild swapping instances (or moving on/off the public deployment) naturally lands on
	 * a fresh cache entry instead of serving data fetched through an application that no longer owns the
	 * guild, see docs/roadmap/01-architecture.md §8.
	 */
	cacheKey: string;
}

/**
 * Resolves which `API` client (i.e. bot token) owns a given `(botId, guildId)` pair. Only `MODMAIL` can ever
 * resolve to a custom instance -- `AMA` (and any other future bot) always uses its single public token,
 * since custom instances are a ModMail-only concept (see docs/roadmap/01-architecture.md §8).
 */
export function resolveGuildAPI(botId: BotId, guildId: Snowflake): ResolvedGuildAPI {
	if (botId === 'MODMAIL') {
		const instance = getInstanceForGuild(guildId);
		if (instance) {
			return { api: apiForInstance(instance), cacheKey: instance.id };
		}
	}

	return { api: APIMapping[botId], cacheKey: 'public' };
}

/**
 * Convenience wrapper around `resolveGuildAPI` for call sites that only need the `API` client, not the cache
 * key -- most route handlers.
 */
export function apiForGuild(botId: BotId, guildId: Snowflake): API {
	return resolveGuildAPI(botId, guildId).api;
}

// Tracks, per guild, the index (into that guild's `bots` array) that was last handed out by
// `roundRobinAPI`, so consecutive calls for the same guild cycle through all bots installed there.
const latest = new Map<Snowflake, number>();

/**
 * Picks the `API` client (i.e. bot token) to use for a Discord API call scoped to `guild`.
 *
 * A guild can have more than one ChatSift bot installed in it (`guild.bots`). Rather than always
 * using the same bot, for general maintanance calls, this spreads calls round-robin across
 * every bot present in the guild, so outbound request volume -- and therefore per-bot rate-limit bucket usage --
 * doesn't concentrate on a single token. Call it once per outbound Discord API request you're about to make, not once
 * up front and reused for a batch of calls, otherwise the batch never actually rotates across bots.
 *
 * The rotation state (`latest`) is in-memory and per-process: it resets on restart and isn't shared
 * across replicas, so this is a best-effort spread, not a strict guarantee.
 *
 * Requires `guild.bots` to be non-empty -- callers must check that themselves (e.g. a guild whose
 * bots were all kicked but which still has leftover data referencing it). Calling this with an
 * empty `guild.bots` does not throw; it silently returns `APIMapping[undefined]`, i.e. `undefined`.
 */
export function roundRobinAPI(guild: MeGuild): API {
	if (guild.bots.length === 1) {
		return apiForGuild(guild.bots[0]!, guild.id);
	}

	const index = latest.get(guild.id) ?? -1;
	const nextIndex = (index + 1) % guild.bots.length;
	latest.set(guild.id, nextIndex);

	return apiForGuild(guild.bots[nextIndex]!, guild.id);
}
