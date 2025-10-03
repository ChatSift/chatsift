import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';
import { Providers } from '@/components/common/Providers';
import { ScrollArea } from '@/components/common/ScrollArea';
import { Footer } from '@/components/footer/Footer';
import { Navbar } from '@/components/nav/Navbar';
import { server } from '@/data/server';

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
					<HydrationBoundary state={await server.auth.me.prefetch()}>
						<ScrollArea className="h-screen">
							<div className="h-screen flex flex-col min-h-screen">
								<Navbar />
								<div className="flex flex-[1_1_auto] flex-grow flex-col gap-8">
									<main className="mx-auto mb-auto flex max-w-[80vw] flex-col justify-center gap-6 pt-6 lg:min-w-[900px] md:min-w-[640px] min-w-[320px]">
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
