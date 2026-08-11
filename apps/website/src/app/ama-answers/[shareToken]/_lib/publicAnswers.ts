import { cache } from 'react';
import { apiFetch } from '@/api/fetch';
import type { PublicAMAAnswersResult } from '@/api/routes/ama';
import { publicAMAAnswersPath } from '@/api/routes/ama';

/**
 * Server-side read of the (unauthenticated) public answers endpoint, shared by this route's
 * `generateMetadata`, its page render, and its `opengraph-image` (#295).
 *
 * `cache()` is what keeps that to a single API call: `apiFetch`'s server branch hardcodes
 * `cache: 'no-store'`, deliberately opting out of Next's own fetch memoization, so without this every one of
 * those three would be its own round trip on every page load and every unfurl.
 */
export const getPublicAnswers = cache(async (shareToken: string): Promise<PublicAMAAnswersResult> =>
	apiFetch<PublicAMAAnswersResult>('get', publicAMAAnswersPath(shareToken)),
);

/**
 * Same fetch, but resolving to `null` instead of throwing -- a bad or expired share token is an ordinary
 * outcome here, and neither a metadata nor an image route may throw: the first would 500 the page a visitor
 * should see the "AMA not found" empty state on, the second would render a broken image into the embed.
 */
export async function getPublicAnswersOrNull(shareToken: string): Promise<PublicAMAAnswersResult | null> {
	try {
		return await getPublicAnswers(shareToken);
	} catch {
		return null;
	}
}
