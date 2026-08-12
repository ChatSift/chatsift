import { getContext, publishRealtimeInvalidate } from '@chatsift/backend-core';
import { socialLeaderboardChannel } from '@chatsift/core';

/**
 * How long one guild's leaderboard signal suppresses the next. XP grants are the hottest write this bot makes
 * -- an active guild produces one every few seconds, and each one would otherwise cost every connected
 * dashboard and public page a full refetch (a ranked query plus a `GET /users/{id}` per row on a cold cache).
 */
const THROTTLE_SECONDS = 5;

function throttleKey(guildId: string): string {
	return `social:leaderboard-signal:${guildId}`;
}

/**
 * Tells anyone watching a guild's leaderboard that it moved, at most once per {@link THROTTLE_SECONDS}.
 *
 * The gate is a redis `SET NX EX` rather than an in-process timer, so it holds across replicas and needs
 * nothing cleaned up on shutdown -- the same reason every other coalescing key in this stack is shaped that
 * way. Leading-edge: the first grant in a burst publishes immediately and the rest of the window is silent.
 *
 * The accepted cost of leading-edge is that the *last* grant before a guild goes quiet may never be
 * broadcast, leaving a watcher up to one grant stale until the next one lands. That's invisible on a
 * leaderboard -- a single grant almost never reorders the ranks it's rendered as -- and the alternative
 * (trailing edge) needs a timer owner, which is exactly what a stateless throttle avoids. A reconnecting
 * client re-reads regardless: `RealtimeClient` fires a catch-up invalidation for every channel on `open`.
 *
 * Never throws, matching `publishRealtimeInvalidate`'s own contract: a missed refresh must not fail the XP
 * grant that already committed.
 */
export async function broadcastLeaderboardChange(guildId: string): Promise<void> {
	try {
		const claimed = await getContext().redis.set(throttleKey(guildId), '1', {
			condition: 'NX',
			expiration: { type: 'EX', value: THROTTLE_SECONDS },
		});

		if (claimed === null) {
			return;
		}
	} catch (error) {
		// A redis failure here means the throttle is unavailable, not that the signal is unwanted. Publishing
		// anyway is the safer half of the trade: `publishRealtimeInvalidate` needs the same redis to do
		// anything at all, so this almost always no-ops immediately after.
		getContext().logger.warn({ err: error, guildId }, 'leaderboard broadcast throttle unavailable, publishing anyway');
	}

	await publishRealtimeInvalidate(socialLeaderboardChannel(guildId));
}
