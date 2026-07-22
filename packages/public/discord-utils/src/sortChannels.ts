import { ChannelType } from 'discord-api-types/v10';

const GUILD_TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildNews, ChannelType.GuildForum];
const THREAD_TYPES = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread];

/**
 * The minimal channel shape `sortChannels` actually reads from -- callers aren't required to hand it a full
 * over-the-wire `APIChannel`, just anything with these fields (e.g. a dashboard's slimmer cached projection).
 */
export interface SortableChannelLike {
	id: string;
	parent_id?: string | null;
	position?: number;
	type: ChannelType;
}

/**
 * Sorts an array of text, category channels, and threads. Generic over `TChannel` so the input shape is
 * preserved on the way out instead of being widened/narrowed to a specific Discord API union.
 */
export function sortChannels<TChannel extends SortableChannelLike>(unsorted: TChannel[]): TChannel[] {
	const filtered = unsorted.filter(
		(channel) =>
			GUILD_TEXT_TYPES.includes(channel.type) ||
			channel.type === ChannelType.GuildCategory ||
			THREAD_TYPES.includes(channel.type),
	);

	// Separate threads from other channels
	const threads = filtered.filter((channel) => THREAD_TYPES.includes(channel.type));
	const nonThreads = filtered.filter((channel) => !THREAD_TYPES.includes(channel.type));

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

			return (a.position ?? 0) - (b.position ?? 0);
		});

	const channels: TChannel[] = [];
	for (const top of sortedTopLevel ?? []) {
		channels.push(top);

		if (top.type === ChannelType.GuildCategory) {
			// Add channels in this category
			const categoryChannels = (grouped[top.id] ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
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

	return channels.length ? channels : filtered.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
