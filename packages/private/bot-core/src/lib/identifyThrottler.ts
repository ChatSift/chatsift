import { setTimeout as sleep } from 'node:timers/promises';
import type { GuildListKey } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { IIdentifyThrottler } from '@discordjs/ws';

/**
 * Discord allows one IDENTIFY per five seconds per rate-limit bucket, where a shard's bucket is
 * `shardId % max_concurrency`.
 */
const IDENTIFY_WINDOW_MS = 5_000;

const bucketKey = (botId: GuildListKey, bucket: number): string => `identify:${botId}:${bucket}`;

/**
 * An identify throttler that coordinates through redis instead of process memory.
 *
 * `@discordjs/ws`'s default `SimpleIdentifyThrottler` holds an `AsyncQueue` per bucket in a module-level map,
 * which is exactly right for one process and blind the moment a second replica exists: both would happily
 * identify a same-bucket shard inside the same five-second window, and Discord answers that by invalidating
 * sessions -- which, since every replica is reconnecting at once during a deploy, is when it is most likely to
 * happen and most expensive.
 *
 * `SET NX PX` per bucket is the whole mechanism: whoever sets the key owns the window, everyone else waits out
 * its TTL and retries. No lock needs releasing, so a replica that dies mid-identify costs one window rather than
 * wedging the bucket.
 */
export function createRedisIdentifyThrottler(botId: GuildListKey, maxConcurrency: number): IIdentifyThrottler {
	return {
		async waitForIdentify(shardId: number, signal: AbortSignal): Promise<void> {
			const { logger, redis } = getContext();
			const bucket = shardId % Math.max(1, maxConcurrency);
			const key = bucketKey(botId, bucket);

			// There is deliberately no wall-clock bound on this loop, only the caller's `signal`. Waiting a long
			// time here is the *normal* case, not a fault: with `max_concurrency: 1` -- which is what every bot
			// under 150k guilds gets -- every shard shares bucket 0 and identifies one per five seconds, so a
			// 16-shard bot's last shard legitimately waits 80 seconds on a cold start. Any fixed bound generous
			// enough for that is indistinguishable from no bound, and one that isn't turns a healthy queue into a
			// rate-limit violation exactly when the most shards are starting at once.
			//
			// It cannot wedge: every key carries `IDENTIFY_WINDOW_MS` as its TTL, so the wait is bounded by the
			// number of shards queued ahead times that window, and redis being unreachable is handled below.
			while (!signal.aborted) {
				try {
					const claimed = await redis.set(key, String(shardId), {
						condition: 'NX',
						expiration: { type: 'PX', value: IDENTIFY_WINDOW_MS },
					});

					if (claimed) {
						return;
					}

					// Wait out whatever is left of the current holder's window rather than polling blindly. A
					// missing/expired TTL just means it lapsed between the two calls, so retry immediately.
					const remaining = await redis.pTTL(key);
					await sleep(remaining > 0 ? Math.min(remaining, IDENTIFY_WINDOW_MS) : 0, undefined, { signal });
				} catch (error) {
					if (signal.aborted) {
						return;
					}

					// Never block a shard from connecting because redis is unavailable -- fall back to the local
					// pacing this would otherwise coordinate.
					logger.error({ err: error, shardId, bucket }, 'identify throttle failed, pacing locally instead');
					await sleep(IDENTIFY_WINDOW_MS);
					return;
				}
			}
		},
	};
}
