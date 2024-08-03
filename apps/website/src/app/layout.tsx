import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';
import { Providers } from '~/app/providers';

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

export default function RootLayout({ children }: PropsWithChildren) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className="bg-base dark:bg-base-dark">
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
