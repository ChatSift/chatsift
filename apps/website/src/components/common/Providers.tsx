'use client';

import { store } from '@chatsift/web-core/api/store';
import { ErrorBanner } from '@chatsift/web-core/components/ErrorBanner';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Provider as JotaiProvider } from 'jotai';
import { ThemeProvider } from 'next-themes';
import type { PropsWithChildren } from 'react';
import { getBrowserQueryClient } from '@/api/queryClient';

export function Providers({ children }: PropsWithChildren) {
	const queryClient = getBrowserQueryClient();

	return (
		<QueryClientProvider client={queryClient}>
			<JotaiProvider store={store}>
				<ThemeProvider attribute="class">{children}</ThemeProvider>
				<ErrorBanner />
			</JotaiProvider>
			<ReactQueryDevtools buttonPosition="bottom-right" initialIsOpen={false} />
		</QueryClientProvider>
	);
}
