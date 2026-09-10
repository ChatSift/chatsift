import { OG_CONTENT_TYPE, OG_SIZE } from '@chatsift/web-core/utils/ogConstants';
import type { Metadata } from 'next';

export const SITE_NAME = 'unban.app';

/**
 * The landing page's `<h1>`, reused as the site-wide social card's headline. Kept in sync with `app/page.tsx`
 * by hand -- there is no single source of truth to derive it from, same as the dashboard's `SITE_TAGLINE`.
 */
export const SITE_TAGLINE = 'Appeal a Discord ban';

/**
 * Site-wide fallback `description`/`og:description`. Says what the site is for without promising a decision
 * always comes back -- a silent denial (#232 decision 6) reads as pending forever, so "check where it stands"
 * is the honest claim and "we will let you know" is not.
 */
export const SITE_DESCRIPTION =
	'Ask the moderators of a Discord server to take another look at your ban, and check where your appeal stands.';

/**
 * `automoderator.app`, for the handful of links that leave this site: the footer's Terms/Privacy/GitHub/Support
 * and the header's Support link. `unban.app` is its own eTLD+1 and has none of those routes (#232 decision 3),
 * so they cannot be relative the way the dashboard's are.
 *
 * From the environment rather than hardcoded because dev and prod differ, the same split `NEXT_PUBLIC_API_URL`
 * already uses. The fallback is production rather than localhost on purpose: a missing var should send somebody
 * to the real Terms page, not to a port that is probably not running.
 */
export const SITE_URL = process.env['NEXT_PUBLIC_WEBSITE_URL'] ?? 'https://automoderator.app';

/**
 * Origin every absolute URL in this app's metadata resolves against (`metadataBase`, and therefore the
 * `og:image`/`og:url` a crawler sees). `VERCEL_PROJECT_PRODUCTION_URL` points at the production domain even on
 * a preview deploy, which is what canonical and OG URLs want -- unlike `VERCEL_URL`, the per-deployment hash
 * domain Next would otherwise default to. Read server-side only, so it needs no `NEXT_PUBLIC_` prefix.
 */
export function appealsSiteUrl(): string {
	const vercelUrl = process.env['VERCEL_PROJECT_PRODUCTION_URL'];
	return vercelUrl ? `https://${vercelUrl}` : 'http://localhost:3001';
}

/**
 * URL of the site-wide card rendered by `app/opengraph-image.tsx`.
 *
 * A literal because Next's `opengraph-image` file convention is **not** inherited by nested route segments --
 * the dashboard verified that the hard way (see its own `site.ts`). Routes without a card of their own point
 * `openGraph.images` here rather than each shipping a stub image route.
 */
const OG_DEFAULT_IMAGE_PATH = '/opengraph-image';

export interface SocialMetadataOptions {
	readonly description: string;
	/**
	 * Whether crawlers should index this page. Only the landing page should: everything else is either a
	 * specific server's appeal form or somebody's own appeal history.
	 */
	readonly index?: boolean;
	/**
	 * Root-relative path of the page, resolved against `metadataBase` into `og:url`.
	 */
	readonly path: string;
	/**
	 * The page title, *without* the ` | unban.app` suffix -- the root layout's `title.template` appends that to
	 * the `<title>`, and this appends it to the social titles by hand.
	 */
	readonly title: string;
}

/**
 * Builds a page's `title`/`description`/`openGraph`/`twitter`/`robots` in one go, mirroring the dashboard's
 * `socialMetadata`.
 *
 * Worth a helper for the same reason it is there: Next merges metadata *shallowly*, so a route that declares
 * any `openGraph` field replaces the root layout's entire `openGraph` object rather than extending it --
 * `type`/`siteName`/`locale` have to be restated on every page that wants a custom title. And `title.template`
 * only ever applies to the `<title>` tag, so `og:title` carries the suffix itself.
 */
export function socialMetadata({ description, index = false, path, title }: SocialMetadataOptions): Metadata {
	const socialTitle = `${title} | ${SITE_NAME}`;
	const images = [
		{ url: OG_DEFAULT_IMAGE_PATH, ...OG_SIZE, type: OG_CONTENT_TYPE, alt: `${SITE_NAME} -- ${SITE_TAGLINE}` },
	];

	return {
		title,
		description,
		// `follow` stays on even where `index` is off: a crawler that reaches an appeal page should still be
		// able to walk back out to the landing page it links to.
		robots: index ? undefined : { index: false, follow: true },
		openGraph: {
			type: 'website',
			siteName: SITE_NAME,
			locale: 'en_US',
			title: socialTitle,
			description,
			url: path,
			images,
		},
		twitter: {
			card: 'summary_large_image',
			title: socialTitle,
			description,
			images,
		},
	};
}

/**
 * Re-exported rather than re-declared: `@chatsift/web-core` owns these now that both apps render the same card
 * through the same renderer. They live in their own module there, away from `utils/og.tsx`, so importing them
 * costs nothing of `next/og`.
 */
export { OG_CONTENT_TYPE, OG_SIZE } from '@chatsift/web-core/utils/ogConstants';
