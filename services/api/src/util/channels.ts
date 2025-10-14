import { setTimeout } from 'node:timers';
import type {
	API,
	APIGuildChannel,
	APISortableChannel,
	APIThreadChannel,
	GuildChannelType,
	Snowflake,
} from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';

export interface PossiblyMissingChannelInfo {
	id: string;
}

export type GuildChannelInfo = APISortableChannel &
	Pick<APIGuildChannel<GuildChannelType>, 'id' | 'name' | 'parent_id' | 'type'>;

// TODO(DD): Should probably move this to redis
const CACHE = new Map<Snowflake, GuildChannelInfo[]>();
const CACHE_TIMEOUTS = new Map<string, NodeJS.Timeout>();
const CACHE_TTL = 5 * 60 * 1_000; // 5 minutes

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
