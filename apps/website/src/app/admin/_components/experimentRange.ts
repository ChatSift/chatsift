import { EXPERIMENT_BUCKET_COUNT } from '@chatsift/core';

/**
 * The share of guilds a range covers. Buckets are what the API and the database speak, but "1250" is not a
 * number anyone reasons about a rollout in, so every place a range is shown pairs the two.
 *
 * Two decimals is exactly the precision 10,000 buckets can express, so this never rounds a real range into a
 * percentage that would map back to a different one.
 */
export function rangeSharePercent(rangeStart: number, rangeEnd: number): string {
	const share = ((rangeEnd - rangeStart) / EXPERIMENT_BUCKET_COUNT) * 100;
	return `${Number(share.toFixed(2))}%`;
}
