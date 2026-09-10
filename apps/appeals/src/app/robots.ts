import type { MetadataRoute } from 'next';

/**
 * Only the landing page is meant to be indexed. Everything else is either a specific server's appeal form or
 * somebody's own appeal history.
 *
 * Those are handled with `noindex` (via `socialMetadata`) rather than `Disallow`, deliberately, and for the
 * reason the dashboard's `robots.ts` spells out: a crawler has to be allowed to fetch a page before it can see
 * that page's `noindex`. `/g/<guildId>` is a URL guilds paste publicly, so disallowing the fetch would leave it
 * eligible to appear as a bare, snippet-less result -- exactly what the `noindex` is there to prevent.
 * Allowing the fetch is what makes it stick, and it costs nothing: every one of those pages is client-rendered
 * behind a session, so a crawler reaches a sign-in prompt and no Discord call is ever made on its behalf.
 */
export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: '*',
			allow: '/',
		},
	};
}
