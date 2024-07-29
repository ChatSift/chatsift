import type { PropsWithChildren } from 'react';
import { Providers } from './providers';

import '~/styles/globals.css';

export default async function RootLayout({ children }: PropsWithChildren) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
