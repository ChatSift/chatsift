import type { APIChannel, APIGuildCategoryChannel, APITextChannel, APIThreadChannel } from 'discord-api-types/v10';
import { ChannelType } from 'discord-api-types/v10';

const GUILD_TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildNews, ChannelType.GuildForum];
const THREAD_TYPES = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread];

type SortableChannel = APIGuildCategoryChannel | APITextChannel | APIThreadChannel;

/**
 * Sorts an array of text, category channels, and threads
 */
export function sortChannels(unsorted: APIChannel[]): SortableChannel[] {
	const filtered = unsorted.filter(
		(channel): channel is SortableChannel =>
			GUILD_TEXT_TYPES.includes(channel.type) ||
			channel.type === ChannelType.GuildCategory ||
			THREAD_TYPES.includes(channel.type),
	);

	// Separate threads from other channels
	const threads = filtered.filter((channel): channel is APIThreadChannel => THREAD_TYPES.includes(channel.type));
	const nonThreads = filtered.filter((channel) => !THREAD_TYPES.includes(channel.type)) as (
		| APIGuildCategoryChannel
		| APITextChannel
	)[];

	// Group the non-thread channels by their category - or "top" if they aren't in one
	const grouped = Object.groupBy(nonThreads, (channel) => channel.parent_id ?? 'top');

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

			return a.position - b.position;
		});

	const channels: SortableChannel[] = [];
	for (const top of sortedTopLevel ?? []) {
		channels.push(top);

		if (top.type === ChannelType.GuildCategory) {
			// Add channels in this category
			const categoryChannels = (grouped[top.id] ?? []).sort((a, b) => a.position! - b.position!);
			channels.push(...categoryChannels);

			// Add threads for each channel in the category
			for (const channel of categoryChannels) {
				const channelThreads = threads
					.filter((thread) => thread.parent_id === channel.id)
					.sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));
				channels.push(...channelThreads);
			}
		} else {
			// Add threads for top-level channels
			const channelThreads = threads
				.filter((thread) => thread.parent_id === top.id)
				.sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));
			channels.push(...channelThreads);
		}
	}

	return channels.length
		? channels
		: filtered.sort((a, b) => {
				const aPos = 'position' in a ? (a.position ?? 0) : 0;
				const bPos = 'position' in b ? (b.position ?? 0) : 0;
				return aPos - bPos;
			});
}
