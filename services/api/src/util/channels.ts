import { setTimeout, clearTimeout } from 'node:timers';
import type { Logger } from '@chatsift/backend-core';
import type {
	API,
	APIGuildChannel,
	APISortableChannel,
	APIThreadChannel,
	GuildChannelType,
	Snowflake,
} from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badRequest, internal } from '@hapi/boom';

export interface PossiblyMissingChannelInfo {
	id: string;
}

export type GuildChannelInfo = APISortableChannel &
	Pick<APIGuildChannel<GuildChannelType>, 'id' | 'name' | 'parent_id' | 'type'>;

// TODO(DD): Should probably move this to redis
// Partitioned per `API` client instance (not just guildId): the same guildId can be queried through different
// bots' clients (e.g. AMA and MODMAIL both installed in one guild), and each bot has its own guild
// membership/permissions -- sharing one guildId-keyed cache across clients would let one bot's fetch answer for
// another's.
const CACHE = new Map<API, Map<Snowflake, GuildChannelInfo[]>>();
const CACHE_TIMEOUTS = new Map<API, Map<Snowflake, NodeJS.Timeout>>();
// Tracks the one fetch currently in flight for a given (api, guildId), so overlapping calls (e.g. a forced
// refresh landing while an earlier fetch for the same key hasn't resolved yet) share its result instead of
// racing their own cache mutations against each other -- whichever call resolves "last" would otherwise be able
// to clobber a newer write (a late forced-403 delete stomping a fresher success) or resurrect stale data (an old
// success completing after a forced invalidation).
const INFLIGHT = new Map<API, Map<Snowflake, Promise<GuildChannelInfo[] | null>>>();
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

async function fetchAndCacheGuildChannels(
	guildId: string,
	api: API,
	force: boolean,
	cache: Map<Snowflake, GuildChannelInfo[]>,
	timeouts: Map<Snowflake, NodeJS.Timeout>,
): Promise<GuildChannelInfo[] | null> {
	// TODO(DD): https://github.com/discordjs/discord-api-types/pull/1397
	const channelsRaw = await (
		api.guilds.getChannels(guildId) as Promise<(APIGuildChannel<GuildChannelType> & APISortableChannel)[]>
	).catch((error) => {
		if (error instanceof DiscordAPIError && (error.status === 403 || error.status === 404)) {
			return null;
		}

		throw error;
	});

	if (!channelsRaw) {
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

	const channels: GuildChannelInfo[] = channelsRaw.map(({ id, name, parent_id, type, position }) => ({
		id,
		name,
		parent_id: parent_id ?? null,
		type,
		position,
	}));

	const { threads: threadsRaw } = await api.guilds.getActiveThreads(guildId);
	const threads: GuildChannelInfo[] = (threadsRaw as APIThreadChannel[]).map(({ id, name, parent_id, type }) => ({
		id,
		name,
		parent_id: parent_id!,
		type,
		position: 0, // Threads don't have a position, this should be good enough
	}));

	const allChannels = channels.concat(threads);

	cache.set(guildId, allChannels);
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

	return allChannels;
}

export async function fetchGuildChannels(guildId: string, api: API, force = false): Promise<GuildChannelInfo[] | null> {
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
			return await fetchAndCacheGuildChannels(guildId, api, force, cache, timeouts);
		} finally {
			inflight.delete(guildId);
		}
	})();

	inflight.set(guildId, promise);
	return promise;
}

/**
 * Guards against a guild manager pointing AMA channel fields (prompt/answers/mod-queue/etc) at a channel that
 * belongs to a *different* guild — `discordAPIAma` is a single bot client shared across every guild it's installed
 * in, so nothing else stops a caller from supplying an arbitrary snowflake there. Piggybacks on `fetchGuildChannels`'s
 * existing 5-minute cache, which is already warmed by the dashboard's normal read traffic (`getAMA.ts`), so this
 * rarely costs an extra Discord API call in practice.
 */
export async function assertChannelsBelongToGuild(
	guildId: Snowflake,
	channelIds: (Snowflake | null | undefined)[],
	api: API,
	logger: Logger,
): Promise<void> {
	// eslint-disable-next-line unicorn/prefer-native-coercion-functions
	const ids = channelIds.filter((id): id is Snowflake => Boolean(id));
	if (!ids.length) {
		return;
	}

	const channels = await fetchGuildChannels(guildId, api);
	if (!channels) {
		logger.warn({ guildId }, `Failed to fetch channels for guild ${guildId}`);
		throw internal();
	}

	const validIds = new Set(channels.map((channel) => channel.id));
	for (const id of ids) {
		if (!validIds.has(id)) {
			throw badRequest(`channel ${id} does not belong to this guild`);
		}
	}
}
