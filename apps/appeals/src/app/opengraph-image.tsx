import { renderOgCard } from '@chatsift/web-core/utils/og';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from '@/utils/site';

// Next reads `size`/`contentType` off this module to emit the `og:image:width`/`height`/`type` tags alongside
// the image URL.
export { OG_CONTENT_TYPE as contentType, OG_SIZE as size } from '@/utils/site';

export const alt = `${SITE_NAME} -- ${SITE_TAGLINE}`;

/**
 * The site-wide social card. Rendered by the same `renderOgCard` the dashboard uses, so a link to either site
 * unfurls identically apart from the wordmark -- which is the point: an appellant handed an `unban.app` link
 * should see something that looks like it belongs to the same people as the bot that banned them.
 */
export default async function Image() {
	return renderOgCard({
		siteName: SITE_NAME,
		title: SITE_TAGLINE,
		subtitle: SITE_DESCRIPTION,
	});
}
