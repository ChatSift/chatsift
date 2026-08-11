import type { MetadataRoute } from 'next';

/**
 * Link unfurlers ignore `robots.txt` and `robots` meta entirely, so none of this costs us an embed (#295) --
 * it only keeps search engines out of the two surfaces that shouldn't be indexed:
 *
 * - `/dashboard/*`, which `proxy.ts` now lets social crawlers into. There's nothing to index there (every
 *   byte of real content is fetched client-side against an authenticated API), and being explicit is
 *   cheaper than relying on that staying true.
 * - `/ama-answers/*`, whose share token is a capability -- the page is public to anyone holding the link,
 *   which is not the same as wanting it in a search index. The route also sets `robots: { index: false }`
 *   on its own metadata, since a `robots.txt` disallow only stops crawling, not indexing of a URL someone
 *   else linked.
 */
export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: '*',
			allow: '/',
			disallow: ['/dashboard/', '/ama-answers/'],
		},
	};
}
