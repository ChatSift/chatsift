import { getContext, RedisStore } from '@chatsift/backend-core';
import { createInflightDeduper } from '@chatsift/core';
import type { API } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';

/**
 * A channel's ancestry, which no gateway payload carries.
 *
 * `MESSAGE_CREATE`/`MESSAGE_DELETE` name a channel and nothing above it, but two products need the chain: Social
 * resolves a category's XP multiplier for a message posted in one of its channels (#343), and AutoModerator
 * resolves a log exemption that may be set on the category rather than the channel (P4, feature 35). Both walked
 * the same three levels through the same cached `GET /channels/{id}`, so it lives here rather than twice.
 *
 * Redis rather than a process-local map so the cache survives restarts and is shared across replicas and across
 * bots -- a channel id is globally unique and its parent is the same answer whichever token asks, exactly the
 * reasoning behind `backend-core`'s shared user cache.
 */

interface CachedChannel {
	/**
	 * `null` is a real, cacheable answer -- a top-level channel with no category -- and is what ends the walk.
	 * It is not the same as a cache miss.
	 */
	parentId: string | null;
}

// Channel topology changes rarely and a stale answer is cheap, so this leans long. `RedisStore.get` slides the
// TTL forward on read, so an actively-used channel effectively never expires -- acceptable here, unlike the user
// cache, because a channel's *parent* is close to immutable where a username is not.
const CHANNEL_TTL_MS = 6 * 60 * 60 * 1_000; // 6 hours
// A channel the bot can't see (deleted, or permissions revoked) gets a much shorter entry, so a busy channel
// that becomes unreadable doesn't re-hammer the REST bucket on every message, but a restored permission
// recovers quickly.
const NEGATIVE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

const channelStore = new RedisStore<CachedChannel>({
	TTL: CHANNEL_TTL_MS,
	recipe: createRecipe({ parentId: DataType.String }, { versioned: true }) as Recipe<CachedChannel>,
	makeKey: (channelId: string) => `channelparent:${channelId}`,
	storeOld: false,
});

const negativeKey = (channelId: string) => `channelparent:negative:${channelId}`;

// Purely an in-flight guard, exactly as the user cache does it: several messages landing in the same uncached
// channel at once share one Discord request instead of each issuing their own.
const inflight = createInflightDeduper();

/**
 * A 403/404 means the bot can't see this thing -- a real answer worth caching, not a transient failure. Anything
 * else (a 5xx, a timeout) propagates, so a Discord outage doesn't get baked into the cache as "gone".
 */
function isMissing(error: unknown): boolean {
	return error instanceof DiscordAPIError && (error.status === 403 || error.status === 404);
}

async function loadChannel(api: API, channelId: string): Promise<CachedChannel | null> {
	if (await getContext().redis.exists(negativeKey(channelId))) {
		return null;
	}

	const cached = await channelStore.get(channelId);
	if (cached) {
		return cached;
	}

	return inflight.run(`channelparent:${channelId}`, async () => {
		try {
			const channel = await api.channels.get(channelId);
			const entry: CachedChannel = { parentId: 'parent_id' in channel ? (channel.parent_id ?? null) : null };

			// No `del` of the negative key here, unlike the user cache this is modelled on: the check at the top
			// of this function already returned for anything negatively cached, so reaching here means there is
			// none to clear and the extra round trip would buy nothing.
			await channelStore.set(channelId, entry);

			return entry;
		} catch (error) {
			if (!isMissing(error)) {
				throw error;
			}

			// Debug, not warn: the walk routinely reaches categories nobody granted the bot access to, and both
			// callers degrade gracefully when it does. Logged at all because "the category setting isn't
			// applying" otherwise looks identical to a bad configuration row.
			getContext().logger.debug({ err: error, channelId }, 'channel unreadable while resolving its parent');

			await getContext().redis.set(negativeKey(channelId), '1', {
				expiration: { type: 'PX', value: NEGATIVE_TTL_MS },
			});

			return null;
		}
	});
}

/**
 * The channel itself, then its parent, then its parent's parent — newest-first, and as deep as Discord goes
 * (a thread inside a text channel inside a category). Stops early at the top, or at the first channel the bot
 * cannot read.
 *
 * A caller matching configuration against this walks the returned ids in order, so "the most specific setting
 * wins" falls out of the array rather than needing a second pass.
 */
export async function resolveChannelChain(api: API, channelId: string): Promise<string[]> {
	const chain = [channelId];

	const channel = await loadChannel(api, channelId);
	if (!channel?.parentId) {
		return chain;
	}

	chain.push(channel.parentId);

	const parent = await loadChannel(api, channel.parentId);
	if (parent?.parentId) {
		chain.push(parent.parentId);
	}

	return chain;
}
