import type { BotId, Logger } from '@chatsift/backend-core';
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
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';
import { createCachedGuildFetcher } from './guildDataCache.js';

export interface PossiblyMissingChannelInfo {
	id: string;
}

export type GuildChannelInfo = APISortableChannel &
	Pick<APIGuildChannel<GuildChannelType>, 'id' | 'name' | 'parent_id' | 'type'> & {
		// The set of tags a category's `forumTagId` can be routed to (see docs/roadmap/01-architecture.md
		// §6a's "forum tags only" routing decision) -- always present (empty for non-`ChannelType.GuildForum` channels)
		// rather than optional, so the redis-backed cache below (#246) has one fixed shape to encode.
		availableTags: APIGuildForumTag[];
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
		availableTags: type === ChannelType.GuildForum ? (available_tags ?? []) : [],
	}));

	const { threads: threadsRaw } = await api.guilds.getActiveThreads(guildId);
	const threads: GuildChannelInfo[] = (threadsRaw as APIThreadChannel[]).map(({ id, name, parent_id, type }) => ({
		id,
		name,
		parent_id: parent_id!,
		type,
		position: 0, // Threads don't have a position, this should be good enough
		availableTags: [],
	}));

	return channels.concat(threads);
}

const channelsFetcher = createCachedGuildFetcher(
	'channels',
	// bin-rw's own inferred type is wider than `GuildChannelInfo` -- every `DataType.String` field decodes
	// as `string | null` and `type` as `number | null`, whereas the app-level shape has `parent_id` as the
	// only genuinely-nullable field and `type` narrowed to `GuildChannelType` -- so the cast below is still
	// needed to align the two, just not for the null/empty-string reason it used to be.
	createRecipe(
		{
			items: [
				{
					id: DataType.String,
					name: DataType.String,
					parent_id: DataType.String,
					type: DataType.I32,
					position: DataType.I32,
					availableTags: [
						{
							id: DataType.String,
							name: DataType.String,
							moderated: DataType.Bool,
							emoji_id: DataType.String,
							emoji_name: DataType.String,
						},
					],
				},
			],
		},
		{ versioned: true },
	) as Recipe<{ items: GuildChannelInfo[] }>,
	fetchGuildChannelsRaw,
);

export async function fetchGuildChannels(
	guildId: string,
	botId: BotId,
	force = false,
): Promise<GuildChannelInfo[] | null> {
	return channelsFetcher.fetch(guildId, botId, force);
}

/**
 * Guards against a guild manager pointing AMA channel fields (prompt/answers/mod-queue/etc) at a channel that
 * belongs to a *different* guild -- a bot's REST client is shared across every guild it's installed in, so nothing
 * else stops a caller from supplying an arbitrary snowflake there. Piggybacks on `fetchGuildChannels`'s existing
 * cache, which is already warmed by the dashboard's normal read traffic (`getAMA.ts`), so this rarely costs an
 * extra Discord API call in practice.
 */
export async function assertChannelsBelongToGuild(
	guildId: Snowflake,
	channelIds: (Snowflake | null | undefined)[],
	botId: BotId,
	logger: Logger,
): Promise<void> {
	// eslint-disable-next-line unicorn/prefer-native-coercion-functions
	const ids = channelIds.filter((id): id is Snowflake => Boolean(id));
	if (!ids.length) {
		return;
	}

	const channels = await fetchGuildChannels(guildId, botId);
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

/**
 * Channel types a bot can never send a message to, so a config field meaning "post here" (Social's
 * `levelUpNotificationFallbackChannelId`) must reject them up front rather than failing silently at send time.
 *
 * Deliberately a denylist, not an allowlist of the types that *do* take messages: Discord keeps adding channel
 * types, and a new message-carrying one should work here the day it ships instead of being rejected until
 * someone remembers to widen a list. Threads, voice-channel text and announcement channels all take messages
 * and are all allowed by omission.
 */
const NON_POSTABLE_CHANNEL_TYPES = new Set<number>([
	ChannelType.GuildCategory,
	ChannelType.GuildForum,
	ChannelType.GuildMedia,
	ChannelType.GuildDirectory,
]);

/**
 * `assertChannelsBelongToGuild` plus a "can a message actually be sent here" check -- for the config fields
 * that name a channel the bot will post *to*, as opposed to one it only reads from or matches against.
 */
export async function assertChannelIsPostable(
	guildId: Snowflake,
	channelId: Snowflake,
	botId: BotId,
	logger: Logger,
): Promise<void> {
	const channels = await fetchGuildChannels(guildId, botId);
	if (!channels) {
		logger.warn({ guildId }, `Failed to fetch channels for guild ${guildId}`);
		throw internal();
	}

	const channel = channels.find((entry) => entry.id === channelId);
	if (!channel) {
		throw badRequest(`channel ${channelId} does not belong to this guild`);
	}

	if (NON_POSTABLE_CHANNEL_TYPES.has(channel.type)) {
		throw badRequest(`channel ${channelId} cannot receive messages`);
	}
}
