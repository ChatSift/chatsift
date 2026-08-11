import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata, Viewport } from 'next';
import type { PropsWithChildren } from 'react';
import { Suspense } from 'react';
import { prefetch } from '@/api/fetch';
import { me } from '@/api/routes/auth';
import { Providers } from '@/components/common/Providers';
import { ScrollArea } from '@/components/common/ScrollArea';
import { Footer } from '@/components/footer/Footer';
import { Navbar } from '@/components/nav/Navbar';
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from '@/utils/site';

import '@/styles/globals.css';

export const metadata: Metadata = {
	// Everything relative in any route's metadata -- `og:url`, and the `og:image`/`twitter:image` the
	// `opengraph-image` file conventions generate -- is resolved against this (#295). Without it Next falls
	// back to the per-deployment `VERCEL_URL` hash domain, which is not the URL we want crawlers to cache.
	metadataBase: new URL(siteUrl()),
	title: {
		template: '%s | ChatSift',
		default: 'ChatSift',
	},
	description: SITE_DESCRIPTION,
	applicationName: SITE_NAME,
	icons: {
		other: [{ rel: 'icon', url: '/assets/favicon.ico' }],
	},
	// No `images` key here or on any child route: `app/opengraph-image.tsx` (and the per-route overrides
	// next to it) are file conventions, so Next injects `og:image`/`twitter:image` plus their dimensions
	// into every descendant segment automatically.
	openGraph: {
		type: 'website',
		siteName: SITE_NAME,
		title: SITE_NAME,
		description: SITE_DESCRIPTION,
		url: '/',
		locale: 'en_US',
	},
	twitter: {
		card: 'summary_large_image',
		title: SITE_NAME,
		description: SITE_DESCRIPTION,
	},
};

/**
 * Discord colors an embed's left-hand stripe from `<meta name="theme-color">`, which is what actually makes
 * an unfurled ChatSift link read as ours -- `--color-misc-accent`, the blue in the logo mark.
 */
export const viewport: Viewport = {
	themeColor: '#2f8fee',
};

export default async function RootLayout({ children }: PropsWithChildren) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className="bg-base dark:bg-base-dark">
				<Providers>
					<HydrationBoundary
						state={await prefetch([{ queryKey: me.queryKey, queryFn: async () => me.queryFn(false) }])}
					>
						<ScrollArea className="h-screen">
							<div className="h-screen flex flex-col min-h-screen">
								{/*
									`Navbar` -> `UserDesktop`/`UserMobile` -> `LoginButton` calls `useSearchParams()`, which Next requires
									a Suspense boundary around for any statically-prerendered route -- `/_not-found` is prerendered
									regardless of the rest of the app being forced dynamic, so this is required, not optional.
								*/}
								<Suspense fallback={null}>
									<Navbar />
								</Suspense>
								<div className="flex flex-[1_1_auto] flex-grow flex-col gap-8">
									<main className="mx-auto mb-auto flex w-[clamp(320px,80vw,912px)] flex-col justify-center gap-6 pt-6">
										{children}
									</main>
									<Footer />
								</div>
							</div>
						</ScrollArea>
					</HydrationBoundary>
				</Providers>
			</body>
		</html>
	);
}
