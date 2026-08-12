import type { MetadataRoute } from 'next';

/**
 * Link unfurlers ignore `robots.txt` and `robots` meta entirely, so none of this costs us an embed (#295).
 * It exists purely to keep search engines out of `/dashboard`.
 *
 * No trailing slash: `robots.txt` paths are prefix matches, so `/dashboard/` would cover `/dashboard/<id>`
 * but leave the bare `/dashboard` guild picker -- a real route -- crawlable.
 *
 * `Disallow` is the right tool for the dashboard specifically because a `noindex` could never work there:
 * Googlebot is deliberately absent from `utils/crawlers.ts`'s unfurler allowlist, so `proxy.ts` 307s it to
 * Discord OAuth and it never reaches a page of ours to read a meta tag off.
 *
 * `/ama-answers/*` and `/leaderboard/*` are deliberately *not* listed, despite being the other surfaces we
 * don't want indexed. Those pages carry `robots: { index: false, follow: false }` instead, and the two
 * mechanisms don't stack: a crawler has to be allowed to fetch a page before it can see that page's
 * `noindex`. Disallowing them would suppress the fetch and leave a publicly-linked URL eligible to show up as
 * a bare, snippet-less result -- the exact outcome the `noindex` is there to prevent. Allowing the fetch is
 * what makes it stick.
 */
export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: '*',
			allow: '/',
			disallow: '/dashboard',
		},
	};
}
