import { cache } from 'react';
import { apiFetch } from '@/api/fetch';
import type { PublicSocialLeaderboardResult } from '@/api/routes/social';
import { publicSocialLeaderboardPath, SOCIAL_LEADERBOARD_PAGE_SIZE } from '@/api/routes/social';

/**
 * Server-side read of the (unauthenticated) public leaderboard endpoint, shared by this route's
 * `generateMetadata` and its page render -- and pinned to the first page, which is the only one the server
 * renders. Paging beyond it happens client-side.
 *
 * `cache()` is what keeps that to a single API call: `apiFetch`'s server branch hardcodes `cache: 'no-store'`,
 * deliberately opting out of Next's own fetch memoization, so without this both would be their own round trip
 * on every page load and every unfurl. Same arrangement as `ama-answers`' `_lib/publicAnswers.ts`.
 */
export const getPublicLeaderboard = cache(async (guildId: string): Promise<PublicSocialLeaderboardResult> =>
	apiFetch<PublicSocialLeaderboardResult>('get', publicSocialLeaderboardPath(guildId), {
		query: { limit: SOCIAL_LEADERBOARD_PAGE_SIZE, offset: 0 },
	}),
);

/**
 * Same fetch, resolving to `null` instead of throwing -- a guild with the page switched off (or no Social at
 * all) is an ordinary outcome here, and `generateMetadata` may not throw: it would 500 the page a visitor
 * should see the "not found" empty state on.
 */
export async function getPublicLeaderboardOrNull(guildId: string): Promise<PublicSocialLeaderboardResult | null> {
	try {
		return await getPublicLeaderboard(guildId);
	} catch {
		return null;
	}
}
