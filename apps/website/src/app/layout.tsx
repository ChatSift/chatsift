import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';
import { Providers } from '~/app/providers';
import Footer from '~/components/Footer';
import Navbar from '~/components/Navbar';
import { Toaster } from '~/components/Toaster';

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
			<body className="bg-base dark:bg-base-dark">
				<Providers>
					<div className="h-scren flex min-h-screen flex-col">
						<Navbar />
						<div className="flex flex-[1_1_auto] flex-grow flex-col">
							{children}
							<Footer />
							<Toaster />
						</div>
					</div>
				</Providers>
			</body>
		</html>
	);
}
