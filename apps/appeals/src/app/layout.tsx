import type { Metadata, Viewport } from 'next';
import type { PropsWithChildren } from 'react';
import { Providers } from '@/components/Providers';
import { SiteHeader } from '@/components/SiteHeader';

import '@/styles/globals.css';

export const metadata: Metadata = {
	title: {
		template: '%s | unban.app',
		default: 'unban.app',
	},
	description: 'Appeal a Discord ban in a server that uses ChatSift.',
	applicationName: 'unban.app',
	// Nothing here should ever be indexed: every page below the landing one is either a specific server's
	// appeal form or somebody's own appeal history, and a crawler that walked `/g/<id>` would spend a Discord
	// ban probe on every guild id it found.
	robots: { index: false, follow: false },
};

export const viewport: Viewport = {
	themeColor: '#2f8fee',
};

export default function RootLayout({ children }: PropsWithChildren) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className="min-h-screen bg-base dark:bg-base-dark">
				<Providers>
					<SiteHeader />
					<main className="mx-auto flex w-[clamp(320px,90vw,880px)] flex-col gap-6 py-10">{children}</main>
				</Providers>
			</body>
		</html>
	);
}
