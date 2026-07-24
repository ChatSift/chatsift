import { setTimeout, clearTimeout } from 'node:timers';
import type { Logger } from '@chatsift/backend-core';
import type { API, APIRole, Snowflake } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badRequest, internal } from '@hapi/boom';

export type GuildRoleInfo = Pick<APIRole, 'color' | 'id' | 'managed' | 'name' | 'position'>;

// Mirrors `channels.ts`'s in-memory cache -- see its `TODO(DD)` about moving this to redis. Partitioned per `API`
// client instance (not just guildId): the same guildId can be queried through different bots' clients (e.g. AMA
// and MODMAIL both installed in one guild), and each bot has its own guild membership/permissions -- sharing one
// guildId-keyed cache across clients would let one bot's fetch answer for another's.
const CACHE = new Map<API, Map<Snowflake, GuildRoleInfo[]>>();
const CACHE_TIMEOUTS = new Map<API, Map<Snowflake, NodeJS.Timeout>>();
// Tracks the one fetch currently in flight for a given (api, guildId), so overlapping calls (e.g. a forced
// refresh landing while an earlier fetch for the same key hasn't resolved yet) share its result instead of
// racing their own cache mutations against each other -- whichever call resolves "last" would otherwise be able
// to clobber a newer write (a late forced-403 delete stomping a fresher success) or resurrect stale data (an old
// success completing after a forced invalidation). Mirrors `channels.ts`.
const INFLIGHT = new Map<API, Map<Snowflake, Promise<GuildRoleInfo[] | null>>>();
const CACHE_TTL = 5 * 60 * 1_000; // 5 minutes

export function clearCache() {
	for (const timeouts of CACHE_TIMEOUTS.values()) {
		for (const timeout of timeouts.values()) {
			clearTimeout(timeout);
		}
	}

	CACHE.clear();
	CACHE_TIMEOUTS.clear();
}

function getMapFor<TValue>(store: Map<API, Map<Snowflake, TValue>>, api: API): Map<Snowflake, TValue> {
	let map = store.get(api);
	if (!map) {
		map = new Map();
		store.set(api, map);
	}

	return map;
}

async function fetchAndCacheGuildRoles(
	guildId: string,
	api: API,
	force: boolean,
	cache: Map<Snowflake, GuildRoleInfo[]>,
	timeouts: Map<Snowflake, NodeJS.Timeout>,
): Promise<GuildRoleInfo[] | null> {
	const rolesRaw = await api.guilds.getRoles(guildId).catch((error) => {
		if (error instanceof DiscordAPIError && (error.status === 403 || error.status === 404)) {
			return null;
		}

		throw error;
	});

	if (!rolesRaw) {
		// A forced refresh that now 403/404s means the bot no longer has (or never had) access to this guild --
		// drop any stale cache entry instead of leaving it to answer reads until TTL expiry.
		if (force) {
			cache.delete(guildId);
			const timeout = timeouts.get(guildId);
			if (timeout) {
				clearTimeout(timeout);
				timeouts.delete(guildId);
			}
		}

		return null;
	}

	// The `@everyone` role (id === guildId) is never a sensible "alert role" target -- drop it here so every
	// consumer (validation, the dashboard's role picker) doesn't need to special-case it.
	const roles: GuildRoleInfo[] = rolesRaw
		.filter((role) => role.id !== guildId)
		.map(({ id, name, color, position, managed }) => ({ id, name, color, position, managed }));

	cache.set(guildId, roles);
	if (timeouts.has(guildId)) {
		const timeout = timeouts.get(guildId)!;
		timeout.refresh();
	} else {
		const timeout = setTimeout(() => {
			cache.delete(guildId);
			timeouts.delete(guildId);
		}, CACHE_TTL).unref();

		timeouts.set(guildId, timeout);
	}

	return roles;
}

export async function fetchGuildRoles(guildId: string, api: API, force = false): Promise<GuildRoleInfo[] | null> {
	const cache = getMapFor(CACHE, api);
	const timeouts = getMapFor(CACHE_TIMEOUTS, api);

	if (cache.has(guildId) && !force) {
		return cache.get(guildId)!;
	}

	const inflight = getMapFor(INFLIGHT, api);

	const existing = inflight.get(guildId);
	if (existing) {
		return existing;
	}

	const promise = (async () => {
		try {
			return await fetchAndCacheGuildRoles(guildId, api, force, cache, timeouts);
		} finally {
			inflight.delete(guildId);
		}
	})();

	inflight.set(guildId, promise);
	return promise;
}

/**
 * Guards against a guild manager pointing a role field (e.g. ModMail's `alertRoleId`) at a role that belongs to a
 * different guild -- mirrors `channels.ts`'s `assertChannelsBelongToGuild`.
 */
export async function assertRolesBelongToGuild(
	guildId: Snowflake,
	roleIds: (Snowflake | null | undefined)[],
	api: API,
	logger: Logger,
): Promise<void> {
	// eslint-disable-next-line unicorn/prefer-native-coercion-functions
	const ids = roleIds.filter((id): id is Snowflake => Boolean(id));
	if (!ids.length) {
		return;
	}

	const roles = await fetchGuildRoles(guildId, api);
	if (!roles) {
		logger.warn({ guildId }, `Failed to fetch roles for guild ${guildId}`);
		throw internal();
	}

	const validIds = new Set(roles.map((role) => role.id));
	for (const id of ids) {
		if (!validIds.has(id)) {
			throw badRequest(`role ${id} does not belong to this guild`);
		}
	}
}
