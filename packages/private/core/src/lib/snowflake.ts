/**
 * Discord ids encode their creation time in the top 42 bits (`timestamp = (id >> 22) + discordEpoch`) --
 * computed directly rather than pulling in a whole snowflake-parsing dependency for one arithmetic line.
 */
const DISCORD_EPOCH_MS = 1_420_070_400_000n;

/**
 * When the id was created, in epoch milliseconds.
 *
 * Millisecond precision matters where a snowflake is used as a *clock* rather than as a display timestamp:
 * services/social-bot's XP eligibility window (`lib/eligibility.ts`) derives how much of a rolling window is
 * left from the oldest tracked message's id, and that window can be as short as a second.
 */
export function snowflakeTimestampMs(id: string): number {
	return Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS);
}

/**
 * Convenience for `<t:...>` markdown, which is second-granularity.
 */
export function snowflakeTimestampSeconds(id: string): number {
	return Math.floor(snowflakeTimestampMs(id) / 1_000);
}
