'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Provider as JotaiProvider } from 'jotai';
import Link from 'next/link';
import { ThemeProvider } from 'next-themes';
import { useRef, type PropsWithChildren } from 'react';
import { ToastAction } from '~/components/Toast';
import { useToast } from '~/hooks/useToast';
import { APIError } from '~/util/fetcher';

export function Providers({ children }: PropsWithChildren) {
	const { toast } = useToast();

	const queryClient = useRef(
		new QueryClient({
			queryCache: new QueryCache({
				onError: (error) => {
					if (error instanceof APIError) {
						if (error.payload.statusCode === 403) {
							toast({
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
							toast({
								title: 'Server Error',
								description: 'A server error occurred while processing your request.',
								variant: 'destructive',
							});
						}
					} else {
						toast({
							title: 'Network Error',
							description: 'A network error occurred while processing your request.',
							variant: 'destructive',
						});
					}
				},
			}),
		}),
	);

	return (
		<QueryClientProvider client={queryClient.current}>
			<JotaiProvider>
				<ThemeProvider attribute="class">{children}</ThemeProvider>
			</JotaiProvider>
			<ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
		</QueryClientProvider>
	);
}
