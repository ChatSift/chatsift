import { setTimeout } from 'node:timers';
import type {
	API,
	APIGuildChannel,
	APISortableChannel,
	APIThreadChannel,
	GuildChannelType,
	Snowflake,
} from '@discordjs/core';
import type { MeGuild } from './me.js';

export type GuildChannelInfo = APISortableChannel &
	Pick<APIGuildChannel<GuildChannelType>, 'id' | 'name' | 'parent_id' | 'type'>;

// TODO(DD): Should probably move this to redis
const CACHE = new Map<Snowflake, GuildChannelInfo[]>();
const CACHE_TIMEOUTS = new Map<string, NodeJS.Timeout>();
const CACHE_TTL = 5 * 60 * 1_000; // 5 minutes

export async function fetchGuildChannels(guild: MeGuild, api: API, force = false): Promise<GuildChannelInfo[]> {
	if (CACHE.has(guild.id) && !force) {
		return CACHE.get(guild.id)!;
	}

	// TODO(DD): https://github.com/discordjs/discord-api-types/pull/1397
	const channelsRaw = (await api.guilds.getChannels(guild.id)) as (APIGuildChannel<GuildChannelType> &
		APISortableChannel)[];
	const channels: GuildChannelInfo[] = channelsRaw.map(({ id, name, parent_id, type, position }) => ({
		id,
		name,
		parent_id: parent_id ?? null,
		type,
		position,
	}));

	const { threads: threadsRaw } = await api.guilds.getActiveThreads(guild.id);
	const threads: GuildChannelInfo[] = (threadsRaw as APIThreadChannel[]).map(({ id, name, parent_id, type }) => ({
		id,
		name,
		parent_id: parent_id!,
		type,
		position: 0, // Threads don't have a position, this should be good enough
	}));

	CACHE.set(guild.id, channels);
	if (CACHE_TIMEOUTS.has(guild.id)) {
		const timeout = CACHE_TIMEOUTS.get(guild.id)!;
		timeout.refresh();
	} else {
		const timeout = setTimeout(() => {
			CACHE.delete(guild.id);
			CACHE_TIMEOUTS.delete(guild.id);
		}, CACHE_TTL).unref();

		CACHE_TIMEOUTS.set(guild.id, timeout);
	}

	return channels.concat(threads);
}
