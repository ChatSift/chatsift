import type { APIChannel, APIGuildCategoryChannel, APITextChannel } from 'discord-api-types/v10';
import { ChannelType } from 'discord-api-types/v10';

const GUILD_TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildNews, ChannelType.GuildForum];

/**
 * Sorts an array of text and category channels - **does not support other channel types**
 */
export function sortChannels(unsorted: APIChannel[]): (APIGuildCategoryChannel | APITextChannel)[] {
	const filtered = unsorted.filter(
		(channel): channel is APIGuildCategoryChannel | APITextChannel =>
			GUILD_TEXT_TYPES.includes(channel.type) || channel.type === ChannelType.GuildCategory,
	);

	// Group the channels by their category - or "top" if they aren't in one
	const grouped = Object.groupBy(filtered, (channel) => channel.parent_id ?? 'top');

	// Sort the top level channels - text channels are above category channels, otherwise use their position
	const sortedTopLevel = grouped['top']
		?.filter((channel) => !channel.parent_id)
		.sort((a, b) => {
			if (a.type === ChannelType.GuildText && b.type === ChannelType.GuildCategory) {
				return -1;
			}

			if (a.type === ChannelType.GuildCategory && b.type === ChannelType.GuildText) {
				return 1;
			}

			return a.position! - b.position!;
		});

	const channels: (APIGuildCategoryChannel | APITextChannel)[] = [];
	for (const top of sortedTopLevel ?? []) {
		channels.push(top);

		if (top.type === ChannelType.GuildCategory) {
			channels.push(...(grouped[top.id] ?? []).sort((a, b) => a.position! - b.position!));
		}
	}

	return channels.length ? channels : filtered.sort((a, b) => a.position! - b.position!);
}
