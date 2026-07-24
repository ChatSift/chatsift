import type { Logger } from '@chatsift/backend-core';
import type {
	API,
	APIGuildChannel,
	APIGuildForumTag,
	APISortableChannel,
	APIThreadChannel,
	GuildChannelType,
	Snowflake,
} from '@discordjs/core';
import { ChannelType } from '@discordjs/core';
import { badRequest, internal } from '@hapi/boom';
import { createCachedGuildFetcher } from './guildDataCache.js';

export interface PossiblyMissingChannelInfo {
	id: string;
}

export type GuildChannelInfo = APISortableChannel &
	Pick<APIGuildChannel<GuildChannelType>, 'id' | 'name' | 'parent_id' | 'type'> & {
		// Only present for `ChannelType.GuildForum` channels -- the set of tags a category's `forumTagId` can be
		// routed to (see `docs/roadmap/06-modmail-port.md`'s "forum tags only" routing decision).
		availableTags?: APIGuildForumTag[];
	};

async function fetchGuildChannelsRaw(guildId: string, api: API): Promise<GuildChannelInfo[]> {
	// TODO(DD): https://github.com/discordjs/discord-api-types/pull/1397
	const channelsRaw = (await api.guilds.getChannels(guildId)) as (APIGuildChannel<GuildChannelType> &
		APISortableChannel & { available_tags?: APIGuildForumTag[] })[];

	const channels: GuildChannelInfo[] = channelsRaw.map(({ id, name, parent_id, type, position, available_tags }) => ({
		id,
		name,
		parent_id: parent_id ?? null,
		type,
		position,
		...(type === ChannelType.GuildForum && { availableTags: available_tags ?? [] }),
	}));

	const { threads: threadsRaw } = await api.guilds.getActiveThreads(guildId);
	const threads: GuildChannelInfo[] = (threadsRaw as APIThreadChannel[]).map(({ id, name, parent_id, type }) => ({
		id,
		name,
		parent_id: parent_id!,
		type,
		position: 0, // Threads don't have a position, this should be good enough
	}));

	return channels.concat(threads);
}

const channelsFetcher = createCachedGuildFetcher(fetchGuildChannelsRaw);

export function clearCache() {
	channelsFetcher.clearCache();
}

export async function fetchGuildChannels(guildId: string, api: API, force = false): Promise<GuildChannelInfo[] | null> {
	return channelsFetcher.fetch(guildId, api, force);
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
