'use client';

import type { QueryClientConfig } from '@tanstack/react-query';
import { isServer, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Provider as JotaiProvider } from 'jotai';
import { ThemeProvider } from 'next-themes';
import type { PropsWithChildren } from 'react';
import { APIError } from '@/utils/fetcher';

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
	const base: QueryClientConfig = {
		defaultOptions: {
			queries: {
				staleTime: 60 * 1_000,
			},
		},
	};

	if (isServer) {
		return new QueryClient(base);
	}

	return (browserQueryClient ??= new QueryClient({
		...base,
		queryCache: new QueryCache({
			// TODO: Handle in some way
			onError: (error) => {
				if (error instanceof APIError) {
					console.error('Query error:', error.payload);
				} else {
					console.error('Network Error:', error);
				}
			},
		}),
	}));
}

export function Providers({ children }: PropsWithChildren) {
	const queryClient = getQueryClient();

	return (
		<QueryClientProvider client={queryClient}>
			<JotaiProvider>
				<ThemeProvider attribute="class">{children}</ThemeProvider>
			</JotaiProvider>
			<ReactQueryDevtools buttonPosition="bottom-right" initialIsOpen={false} />
		</QueryClientProvider>
	);
}
