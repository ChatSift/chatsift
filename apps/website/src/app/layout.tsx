import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';
import { SkeletonTheme } from 'react-loading-skeleton';
import { Providers } from '~/app/providers';
import Footer from '~/components/Footer';
import Navbar from '~/components/Navbar';

import '~/styles/globals.css';
import 'react-loading-skeleton/dist/skeleton.css';

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
					<SkeletonTheme inline>
						<div className="h-scren flex min-h-screen flex-col">
							<Navbar />
							<div className="flex flex-[1_1_auto] flex-grow flex-col">
								{children}
								<Footer />
							</div>
						</div>
					</SkeletonTheme>
				</Providers>
			</body>
		</html>
	);
}
