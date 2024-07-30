'use client';

import { Provider as JotaiProvider } from 'jotai';
import { ThemeProvider } from 'next-themes';
import type { PropsWithChildren } from 'react';

export function Providers({ children }: PropsWithChildren) {
	return (
		<JotaiProvider>
			<ThemeProvider attribute="class">{children}</ThemeProvider>
		</JotaiProvider>
	);
}
