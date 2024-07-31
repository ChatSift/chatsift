import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';
import { Providers } from '~/app/providers';
import Navbar from '~/components/Navbar';

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
					<Navbar />
					{children}
				</Providers>
			</body>
		</html>
	);
}
