import { ChannelType } from 'discord-api-types/v10';

/**
 * Channels that carry messages and are not voice-backed. `GuildMedia` is here because a media post is a thread
 * whose parent is the media channel, so dropping the parent drops every post under it too.
 */
const TEXT_TYPES = [
	ChannelType.GuildText,
	ChannelType.GuildAnnouncement,
	ChannelType.GuildForum,
	ChannelType.GuildMedia,
];

/**
 * TiV specifically
 */
const VOICE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

const THREAD_TYPES = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread];

/**
 * Minimal channel info required by `sortChannels`.
 */
export interface SortableChannelLike {
	id: string;
	parent_id?: string | null;
	position?: number;
	type: ChannelType;
}

/**
 * Where a channel sits relative to its siblings.
 */
function sortRank(type: ChannelType): number {
	if (type === ChannelType.GuildCategory) {
		return 2;
	}

	return VOICE_TYPES.includes(type) ? 1 : 0;
}

function byRankThenPosition(first: SortableChannelLike, second: SortableChannelLike): number {
	const rankDelta = sortRank(first.type) - sortRank(second.type);
	return rankDelta === 0 ? (first.position ?? 0) - (second.position ?? 0) : rankDelta;
}

/**
 * Sorts a guild's channels into the order Discord's own sidebar shows them: top-level channels, then each
 * category followed by its channels and their threads.
 *
 * **This is not an access-control filter.** It drops only the types that have no place in a guild tree at all
 * (DMs, directory channels); deciding which of the remainder a user may *pick* is the caller's job -- for the
 * dashboard that is `ChannelSelect`'s `allowedTypes`, which gates both display and selectability. That split
 * matters because this function used to exclude voice channels outright, from before text-in-voice existed,
 * and silently overrode two call sites that had deliberately listed them (Social's per-channel XP config and
 * AutoModerator's log exemptions) -- a filter here is invisible to the caller that thought it had asked.
 */
export function sortChannels<TChannel extends SortableChannelLike>(unsorted: TChannel[]): TChannel[] {
	const filtered = unsorted.filter(
		(channel) =>
			TEXT_TYPES.includes(channel.type) ||
			VOICE_TYPES.includes(channel.type) ||
			channel.type === ChannelType.GuildCategory ||
			THREAD_TYPES.includes(channel.type),
	);

	// Separate threads from other channels
	const threads = filtered.filter((channel) => THREAD_TYPES.includes(channel.type));
	const nonThreads = filtered.filter((channel) => !THREAD_TYPES.includes(channel.type));

	// Group the non-thread channels by their category - or "top" if they aren't in one
	const grouped = Object.groupBy(nonThreads, (channel) => channel.parent_id ?? 'top');

	const sortedTopLevel = grouped['top']?.filter((channel) => !channel.parent_id).sort(byRankThenPosition);

	const threadsOf = (channelId: string): TChannel[] =>
		threads
			.filter((thread) => thread.parent_id === channelId)
			.sort((first, second) => Number(BigInt(second.id) - BigInt(first.id)));

	const channels: TChannel[] = [];
	for (const top of sortedTopLevel ?? []) {
		channels.push(top);

		if (top.type === ChannelType.GuildCategory) {
			// Add channels in this category
			const categoryChannels = (grouped[top.id] ?? []).sort(byRankThenPosition);

			for (const channel of categoryChannels) {
				channels.push(channel, ...threadsOf(channel.id));
			}
		} else {
			channels.push(...threadsOf(top.id));
		}
	}

	return channels.length ? channels : filtered.sort(byRankThenPosition);
}
