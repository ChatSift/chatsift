import { BOTS } from '@chatsift/core';
import { marketingBots, resolveBot } from '@/data/marketingBots';
import { renderOgCard } from '@/utils/og';
import { SITE_DESCRIPTION, SITE_NAME } from '@/utils/site';

export { OG_CONTENT_TYPE as contentType, OG_SIZE as size } from '@/utils/site';

export const alt = `${SITE_NAME} bot`;

/**
 * Mirrors the page's own `generateStaticParams` so both bot cards are generated at build time rather than
 * on the first unfurl -- an unfurler that times out caches the *miss*, so a cold render is worth avoiding.
 */
export function generateStaticParams() {
	return BOTS.map((bot) => ({ name: bot.toLowerCase() }));
}

// Next generates `PageProps`/`LayoutProps` for typed routes but has no equivalent for the metadata file
// conventions, so image routes spell their params out by hand.
export default async function Image({ params }: { readonly params: Promise<{ name: string }> }) {
	const { name } = await params;
	const bot = resolveBot(name);

	// `notFound()` isn't available to an image route, and throwing would surface as a broken image in the
	// embed -- fall back to the generic card, matching what the page's own metadata does for a bad slug.
	if (!bot) {
		return renderOgCard({ title: SITE_NAME, subtitle: SITE_DESCRIPTION });
	}

	const marketing = marketingBots[bot];
	return renderOgCard({
		eyebrow: SITE_NAME,
		title: marketing.pageTitle,
		subtitle: marketing.cardDescription,
	});
}
