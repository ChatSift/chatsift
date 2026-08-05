import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';
import { Suspense } from 'react';
import { prefetch } from '@/api/fetch';
import { me } from '@/api/routes/auth';
import { Providers } from '@/components/common/Providers';
import { ScrollArea } from '@/components/common/ScrollArea';
import { Footer } from '@/components/footer/Footer';
import { Navbar } from '@/components/nav/Navbar';

import '@/styles/globals.css';

export const metadata: Metadata = {
	title: {
		template: '%s | ChatSift',
		default: 'ChatSift',
	},
	icons: {
		other: [{ rel: 'icon', url: '/assets/favicon.ico' }],
	},
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
									`Navbar` -> `UserDesktop`/`UserMobile` -> `useMe()` -> `useGrantAuth()` calls `useSearchParams()`,
									which Next requires a Suspense boundary around for any statically-prerendered route -- `/_not-found`
									is prerendered regardless of the rest of the app being forced dynamic, so this is required, not optional.
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
