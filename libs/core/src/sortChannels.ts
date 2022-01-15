import { groupBy } from './util';
import { APIChannel, ChannelType } from 'discord-api-types/v9';

/**
 * Sorts an array of channels
 * NOTE: ONLY WORKS FOR TEXT AND CATEGORY CHANNELS
 */
export const sortChannels = (unsorted: APIChannel[]): APIChannel[] => {
	// Group the channels by their category - or "top" if they aren't in one
	const grouped = groupBy(unsorted, (c) => c.parent_id ?? 'top');

	// Sort the top level channels - text channels are above category channels, otherwise use their position
	const sortedTopLevel = grouped.top
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

	const channels = [];
	for (const top of sortedTopLevel ?? []) {
		channels.push(top);

		if (top.type === ChannelType.GuildCategory) {
			channels.push(...(grouped[top.id] ?? []).sort((a, b) => a.position! - b.position!));
		}
	}

	return channels;
};
