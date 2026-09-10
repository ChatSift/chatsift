import { Footer } from '@chatsift/web-core/components/Footer';
import type { Metadata, Viewport } from 'next';
import type { PropsWithChildren } from 'react';
import { Providers } from '@/components/Providers';
import { SiteHeader } from '@/components/SiteHeader';
import { appealsSiteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/utils/site';

import '@/styles/globals.css';

export const metadata: Metadata = {
	// Everything relative in any route's metadata -- `og:url`, and the `og:image` the `opengraph-image` file
	// convention generates -- resolves against this. Without it Next falls back to the per-deployment
	// `VERCEL_URL` hash domain, which is not the URL we want crawlers to cache.
	metadataBase: new URL(appealsSiteUrl()),
	title: {
		template: `%s | ${SITE_NAME}`,
		default: SITE_NAME,
	},
	description: SITE_DESCRIPTION,
	applicationName: SITE_NAME,
	// The ChatSift mark, synced out of `@chatsift/web-core/assets/brand` by `sync-web-core-assets.mjs` -- the
	// same file the dashboard shows, pointed at the same way.
	icons: {
		other: [{ rel: 'icon', url: '/assets/favicon.ico' }],
	},
	// No `images` key here or on any child route: `app/opengraph-image.tsx` is a file convention, so Next
	// injects `og:image` plus its dimensions into every descendant segment automatically.
	openGraph: {
		type: 'website',
		siteName: SITE_NAME,
		title: `${SITE_NAME} -- ${SITE_TAGLINE}`,
		description: SITE_DESCRIPTION,
		url: '/',
		locale: 'en_US',
	},
	twitter: {
		card: 'summary_large_image',
		title: `${SITE_NAME} -- ${SITE_TAGLINE}`,
		description: SITE_DESCRIPTION,
	},
};

/**
 * Discord colors an embed's left-hand stripe from `<meta name="theme-color">`, which is what makes an unfurled
 * link read as ours -- `--color-misc-accent`, the blue in the logo mark. Same value as the dashboard's, because
 * it is the same brand.
 */
export const viewport: Viewport = {
	themeColor: '#2f8fee',
};

export default function RootLayout({ children }: PropsWithChildren) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className="bg-base dark:bg-base-dark">
				<Providers>
					<div className="flex min-h-screen flex-col">
						<SiteHeader />
						<main className="mx-auto flex w-[clamp(320px,90vw,880px)] flex-1 flex-col gap-6 py-10">{children}</main>
						{/*
							`siteUrl` because none of the footer's links resolve here -- `/terms`, `/privacy`, `/github`
							and `/support` are all routes on `automoderator.app`, and this is a different eTLD+1. It is
							also what turns the copyright line into the way back to the main site.
						*/}
						<Footer siteUrl={SITE_URL} />
					</div>
				</Providers>
			</body>
		</html>
	);
}
