import type { API } from '@discordjs/core';
import { fetchChannel } from './channels.js';

/**
 * A channel's ancestry, which no gateway payload carries.
 *
 * `MESSAGE_CREATE`/`MESSAGE_DELETE` name a channel and nothing above it, but two products need the chain:
 * Social resolves a category's XP multiplier for a message posted in one of its channels (#343), and
 * AutoModerator resolves a log exemption that may be set on the category rather than the channel (P4, feature
 * 35). Both walked the same three levels through the same channel lookups, so it lives here rather than twice.
 *
 * The lookups themselves are `channels.ts`'s shared cache -- this module used to own a private one, which is
 * now that cache's `parentId` field.
 */

/**
 * The channel itself, then its parent, then its parent's parent — newest-first, and as deep as Discord goes
 * (a thread inside a text channel inside a category). Stops early at the top, or at the first channel the bot
 * cannot read.
 *
 * A caller matching configuration against this walks the returned ids in order, so "the most specific setting
 * wins" falls out of the array rather than needing a second pass.
 *
 * No `maxAge`: a channel's *parent* is close to immutable, and `CHANNEL_UPDATE` priming corrects the rare move
 * between categories without this hot path (every tracked message, in both bots) ever paying for a refresh.
 */
export async function resolveChannelChain(api: API, channelId: string): Promise<string[]> {
	const chain = [channelId];

	const { channel } = await fetchChannel(api, channelId);
	if (!channel?.parentId) {
		return chain;
	}

	chain.push(channel.parentId);

	const { channel: parent } = await fetchChannel(api, channel.parentId);
	if (parent?.parentId) {
		chain.push(parent.parentId);
	}

	return chain;
}
