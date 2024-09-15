import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';
import { Providers } from '~/app/providers';
import { Toaster } from '~/components/common/Toaster';
import Footer from '~/components/footer/Footer';
import Navbar from '~/components/header/Navbar';
import { server } from '~/data/server';
import { cn } from '~/util/util';

import '~/styles/globals.css';

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
			<body className="bg-base-100">
				<Providers>
					<HydrationBoundary state={await server.me.prefetch()}>
						<div className="flex h-screen min-h-screen flex-col">
							<Navbar />
							<div className="flex w-full flex-grow flex-col gap-8">
								<main className={cn('mx-auto mb-auto flex w-full max-w-full flex-col justify-center gap-6 pt-6')}>
									{children}
								</main>
								<Footer />
							</div>
						</div>
						<Toaster />
					</HydrationBoundary>
				</Providers>
			</body>
		</html>
	);
}
