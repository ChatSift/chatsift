import type { PropsWithChildren } from 'react';
import { Providers } from './providers';

import '~/styles/globals.css';

export default async function RootLayout({ children }: PropsWithChildren) {
	return (
		<html lang="en">
			<body className="bg-primary">
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
