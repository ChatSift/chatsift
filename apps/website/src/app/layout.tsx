import type { PropsWithChildren } from 'react';
import { Providers } from './providers';
import Navbar from '~/components/Navbar';

import '~/styles/globals.css';

export default async function RootLayout({ children }: PropsWithChildren) {
	return (
		<html lang="en">
			<body className="bg-zinc-100 dark:bg-zinc-900">
				<Providers>
					<Navbar />
					{children}
				</Providers>
			</body>
		</html>
	);
}
