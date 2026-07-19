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
const CACHE = new Map<Snowflake, GuildChannelInfo[]>();
const CACHE_TIMEOUTS = new Map<string, NodeJS.Timeout>();
const CACHE_TTL = 5 * 60 * 1_000; // 5 minutes

export function clearCache() {
	CACHE.clear();
	for (const timeout of CACHE_TIMEOUTS.values()) {
		clearTimeout(timeout);
	}

	CACHE_TIMEOUTS.clear();
}

export async function fetchGuildChannels(guildId: string, api: API, force = false): Promise<GuildChannelInfo[] | null> {
	if (CACHE.has(guildId) && !force) {
		return CACHE.get(guildId)!;
	}

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

	CACHE.set(guildId, allChannels);
	if (CACHE_TIMEOUTS.has(guildId)) {
		const timeout = CACHE_TIMEOUTS.get(guildId)!;
		timeout.refresh();
	} else {
		const timeout = setTimeout(() => {
			CACHE.delete(guildId);
			CACHE_TIMEOUTS.delete(guildId);
		}, CACHE_TTL).unref();

		CACHE_TIMEOUTS.set(guildId, timeout);
	}

	return allChannels;
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
