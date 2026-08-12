import { getContext } from '@chatsift/backend-core';
import { snowflakeTimestampMs } from '@chatsift/core';

/**
 * The XP eligibility window, ported from `ChatSift/Social`'s `messageCreate.isEligible` with its Redis keys and
 * semantics intact (#343 P3 requires them verbatim -- the port doc calls this logic "subtle, battle-tested").
 *
 * The rule: a user must send `requiredMessages` messages within `timespanSeconds` to earn XP once. Two keys, both
 * per guild+user:
 *
 * | key | type | holds | TTL |
 * | --- | --- | --- | --- |
 * | `leveling_tracking:<guildId>:<userId>` | sorted set | message ids scored by arrival time | `timespanSeconds + 5` |
 * | `leveling_ineligible:<guildId>:<userId>` | string `"true"` | the post-grant bar | remainder of the window, ms |
 *
 * The part that makes the window genuinely *roll*, rather than being a fixed cooldown: once a grant fires, the
 * bar is set to the time left in the window that began with the **oldest message in it** (read out of that
 * message's own snowflake), not to a flat `timespanSeconds` from now. The tracking set is then deleted, which
 * frees the memory but would otherwise make the very next message instantly eligible again -- the bar is what
 * prevents that, so the two are a pair and neither works alone.
 *
 * These keys are deliberately never migrated from the legacy deployment (see the port doc's P5): they're
 * ephemeral by construction, and the worst a cutover costs anyone is one reset window.
 */

export interface EligibilityOptions {
	guildId: string;
	/**
	 * The id of the message being considered -- both the sorted-set member and, when it turns out to be the
	 * oldest one in a completed window, the clock the bar is computed from.
	 */
	messageId: string;
	/**
	 * Guaranteed non-null by the caller: the tracker's inert gate refuses to run at all until a guild has all
	 * three of `required_messages`, `required_messages_timespan` and `xp_gain` set.
	 */
	requiredMessages: number;
	timespanSeconds: number;
	userId: string;
}

/**
 * How far back the tracking set is trimmed on every check, independent of the guild's own window.
 *
 * Without it, a user messaging steadily but never fast enough to complete a window would keep the set alive
 * (every `ZADD` refreshes its TTL) while it grew without bound. Legacy's comment claimed 10 minutes for the TTL
 * fallback and used 5 -- this constant is the one that was always genuinely 10.
 */
const TRACKING_TRIM_MS = 10 * 60 * 1_000;

/**
 * Slack on the tracking set's TTL, so the key can't expire out from under a window that's still legitimately
 * open.
 */
const TRACKING_TTL_SLACK_SECONDS = 5;

function trackingKey(guildId: string, userId: string): string {
	return `leveling_tracking:${guildId}:${userId}`;
}

function ineligibleKey(guildId: string, userId: string): string {
	return `leveling_ineligible:${guildId}:${userId}`;
}

export async function isEligibleForXp({
	guildId,
	messageId,
	requiredMessages,
	timespanSeconds,
	userId,
}: EligibilityOptions): Promise<boolean> {
	// A guild requiring a single message has no window to track at all, so this never touches Redis -- every
	// message earns. Legacy short-circuited here too, and it's why `required_messages` has a lower bound of 1
	// rather than 0.
	if (requiredMessages <= 1) {
		return true;
	}

	const redis = getContext().redis;
	const tracking = trackingKey(guildId, userId);
	const ineligible = ineligibleKey(guildId, userId);

	// `PTTL` answers -2 for a missing key and -1 for one without an expiry; only a non-negative reply means the
	// user is still barred. (A key somehow written without a TTL would read as eligible, which is the safe way
	// round -- it fails open rather than locking someone out permanently.)
	if ((await redis.pTTL(ineligible)) >= 0) {
		return false;
	}

	const now = Date.now();

	await redis.zAdd(tracking, { score: now, value: messageId });
	await redis.expire(tracking, timespanSeconds + TRACKING_TTL_SLACK_SECONDS);
	await redis.zRemRangeByScore(tracking, 0, now - TRACKING_TRIM_MS);

	const windowMs = timespanSeconds * 1_000;
	const messageIds = await redis.zRangeByScore(tracking, now - windowMs, now);

	if (messageIds.length < requiredMessages) {
		return false;
	}

	// `ZRANGEBYSCORE` replies in ascending score order, so index 0 is the oldest message in the window -- the
	// ordering is load-bearing, since that message is what the bar below is measured from.
	//
	// `createRedis` maps every RESP blob string to a `Buffer` (see backend-core's `redis.ts`), so these come
	// back as buffers rather than strings and have to be decoded before being read as a snowflake.
	const oldest = messageIds[0]!.toString();
	const elapsed = now - snowflakeTimestampMs(oldest);

	// `Math.abs` guards the degenerate case legacy asserted on rather than handled: a clock skew or a stale
	// entry can make this negative, and a negative PX is an error reply that would abort the grant entirely.
	const barForMs = Math.abs(windowMs - elapsed);

	await redis.set(ineligible, 'true', { PX: barForMs });
	await redis.del(tracking);

	return true;
}
