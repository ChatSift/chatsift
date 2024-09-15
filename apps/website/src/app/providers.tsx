'use client';

import { ToastAction } from '@radix-ui/react-toast';
import { isServer, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Provider as JotaiProvider } from 'jotai';
import Link from 'next/link';
import { ThemeProvider } from 'next-themes';
import type { PropsWithChildren } from 'react';
import { useToast, type ToastFn } from '~/hooks/useToast';
import { APIError } from '~/util/fetcher';

let browserQueryClient: QueryClient | undefined;

function getQueryClient(toast: ToastFn) {
	const base = {
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
			onError: (error) => {
				if (error instanceof APIError) {
					if (error.payload.statusCode === 403) {
						toast?.({
							title: 'Forbidden',
							description: "You don't have permission to view or edit this config.",
							variant: 'destructive',
							action: (
								<ToastAction altText="Go back">
									<Link href="/dashboard">Go back</Link>
								</ToastAction>
							),
						});
					} else if (error.payload.statusCode >= 500 && error.payload.statusCode < 600) {
						toast?.({
							title: 'Server Error',
							description: 'A server error occurred while processing your request.',
							variant: 'destructive',
						});
					}
				} else {
					toast?.({
						title: 'Network Error',
						description: 'A network error occurred while processing your request.',
						variant: 'destructive',
					});
				}
			},
		}),
	}));
}

export function Providers({ children }: PropsWithChildren) {
	const { toast } = useToast();
	const queryClient = getQueryClient(toast);

	return (
		<QueryClientProvider client={queryClient}>
			<JotaiProvider>
				<ThemeProvider attribute="class">{children}</ThemeProvider>
			</JotaiProvider>
			{/* <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" /> */}
		</QueryClientProvider>
	);
}
