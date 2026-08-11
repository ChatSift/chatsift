import type { Metadata } from 'next';

export const SITE_NAME = 'ChatSift';

/**
 * The landing page's `<h1>`, reused as the site-wide social card's headline. Kept in sync with
 * `app/page.tsx` by hand -- there's no single source of truth to derive it from.
 */
export const SITE_TAGLINE = 'Built for how your server actually runs';

/**
 * One-line summary of what the two bots are for, condensed by hand from their `marketingBots` blurbs.
 * Separate from `SITE_DESCRIPTION` so the site-wide card can pair it with `SITE_TAGLINE` as the headline
 * without the two lines repeating each other.
 */
export const SITE_BOTS_BLURB = 'AMA to coordinate Ask-Me-Anything events, ModMail to handle member inquiries.';

/**
 * Site-wide fallback `description`/`og:description`, used by every route that doesn't set its own. Unlike
 * the card, this has to stand alone in a search result or an embed with no headline above it, so it states
 * the tagline as a clause rather than relying on one being rendered above it.
 */
export const SITE_DESCRIPTION =
	'Discord bots built for how your server actually runs — AMA to coordinate Ask-Me-Anything events, ModMail to handle member inquiries.';

/**
 * Origin every absolute URL in the app's metadata is resolved against (`metadataBase`, and therefore the
 * `og:image`/`og:url` a crawler sees).
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is set automatically by Vercel and always points at the *production*
 * domain, including on preview deploys -- which is what canonical/OG URLs want, unlike `VERCEL_URL` (the
 * per-deployment hash domain) that Next would otherwise default `metadataBase` to. It's read server-side
 * only, so unlike `NEXT_PUBLIC_API_URL` it needs no `NEXT_PUBLIC_` prefix: all metadata is rendered on the
 * server, never in the browser bundle.
 */
export function siteUrl(): string {
	const vercelUrl = process.env['VERCEL_PROJECT_PRODUCTION_URL'];
	return vercelUrl ? `https://${vercelUrl}` : 'http://localhost:3000';
}

/**
 * The size every unfurler expects for a `summary_large_image`-style card. Lives here rather than next to
 * `renderOgCard` so that `utils/site.ts` stays dependency-free -- `utils/og.tsx` pulls in `next/og` and
 * `node:fs`, which nothing importing these constants should have to carry.
 */
export const OG_SIZE = { width: 1_200, height: 630 } as const;

export const OG_CONTENT_TYPE = 'image/png';

/**
 * URL of the site-wide card rendered by `app/opengraph-image.tsx`.
 *
 * Needed as a literal because Next's `opengraph-image` file convention is **not** inherited by nested route
 * segments -- verified against a dev server: `/` picked the root card up, `/terms`, `/privacy` and
 * `/dashboard` emitted no `og:image` at all. Rather than duplicating a stub image route into every segment
 * (there are ~15 under `/dashboard` alone), routes without their own card point `openGraph.images` here.
 */
const OG_DEFAULT_IMAGE_PATH = '/opengraph-image';

export interface SocialMetadataOptions {
	readonly description: string;
	/**
	 * Set on the routes that ship their own `opengraph-image.tsx` (`/bot/[name]`, the AMA share page) so this
	 * helper leaves `images` alone -- the file convention already emits a route-specific one, and setting
	 * both would put two `og:image` tags on the page.
	 */
	readonly hasOwnImage?: boolean;
	/**
	 * Root-relative path of the page, resolved against `metadataBase` into `og:url`.
	 */
	readonly path: string;
	/**
	 * The page title, *without* the ` | ChatSift` suffix -- the root layout's `title.template` appends that
	 * to the `<title>`, and this helper appends it to the social titles by hand (see below).
	 */
	readonly title: string;
}

/**
 * Builds a page's `title`/`description`/`openGraph`/`twitter` in one go (#295).
 *
 * Worth a helper because Next merges metadata *shallowly*: a route that declares any `openGraph` field
 * replaces the root layout's entire `openGraph` object rather than extending it, so `type`/`siteName`/
 * `locale` have to be restated on every page that wants a custom title. Same story for `title.template`,
 * which only ever applies to the `<title>` tag -- `og:title` has to carry the suffix itself.
 */
export function socialMetadata({ description, hasOwnImage, path, title }: SocialMetadataOptions): Metadata {
	const socialTitle = `${title} | ${SITE_NAME}`;
	const images = hasOwnImage
		? undefined
		: [{ url: OG_DEFAULT_IMAGE_PATH, ...OG_SIZE, type: OG_CONTENT_TYPE, alt: `${SITE_NAME} — ${SITE_TAGLINE}` }];

	return {
		title,
		description,
		openGraph: {
			type: 'website',
			siteName: SITE_NAME,
			locale: 'en_US',
			title: socialTitle,
			description,
			url: path,
			...(images && { images }),
		},
		twitter: {
			card: 'summary_large_image',
			title: socialTitle,
			description,
			...(images && { images }),
		},
	};
}
