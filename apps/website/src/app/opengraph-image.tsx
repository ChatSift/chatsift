import { renderOgCard } from '@/utils/og';
import { SITE_BOTS_BLURB, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from '@/utils/site';

// Next reads `size`/`contentType` off this module to emit the `og:image:width`/`height`/`type` tags
// alongside the image URL.
export { OG_CONTENT_TYPE as contentType, OG_SIZE as size } from '@/utils/site';

export const alt = `${SITE_NAME} — ${SITE_DESCRIPTION}`;

/**
 * The site-wide social card: the one `/` renders through the file convention, and the one every other route
 * without a card of its own points at by URL (`socialMetadata`'s `OG_DEFAULT_IMAGE_PATH` -- the convention
 * turns out not to be inherited by nested segments).
 *
 * It has to stay at the app root rather than being duplicated under `/dashboard` -- a
 * `dashboard/opengraph-image` would generate a route sitting behind `proxy.ts`'s matcher, and the image
 * request itself would get redirected to Discord OAuth.
 */
export default async function Image() {
	// `SITE_BOTS_BLURB` rather than `SITE_DESCRIPTION` as the subtitle: the latter restates the tagline, which
	// is already the headline right above it.
	return renderOgCard({
		title: SITE_TAGLINE,
		subtitle: SITE_BOTS_BLURB,
	});
}
