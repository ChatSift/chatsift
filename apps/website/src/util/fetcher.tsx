import type { Payload } from '@hapi/boom';
import Link from 'next/link';
import type { useRouter } from 'next/navigation';
import { ToastAction } from '~/components/Toast';
import type { ToastFn } from '~/hooks/useToast';
import { URLS } from '~/util/constants';

export class APIError extends Error {
	public constructor(
		public readonly payload: Payload,
		public readonly method: string,
	) {
		super(payload.message);
	}
}

export interface FetcherErrorHandlerOptions {
	router: ReturnType<typeof useRouter>;
	toast: ToastFn;
}

export function fetcherErrorHandler({ router, toast }: FetcherErrorHandlerOptions): (error: Error) => boolean {
	return (error) => {
		console.error('error', error);

		if (error instanceof APIError) {
			switch (error.payload.statusCode) {
				case 401: {
					router.push(URLS.API.LOGIN);
					return false;
				}

				case 403: {
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

					return false;
				}
			}

			if (error.payload.statusCode >= 500 && error.payload.statusCode < 600) {
				toast({
					title: 'Server Error',
					description: 'A server error occurred while processing your request.',
					variant: 'destructive',
				});

				return true;
			}
		}

		toast({
			title: 'Network Error',
			description: 'A network error occurred while processing your request.',
			variant: 'destructive',
		});

		return true;
	};
}

export interface FetcherOptions {
	body?: unknown;
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
	path: `/${string}`;
}

const jsonMethods = new Set(['POST', 'PUT', 'PATCH']);

export default function fetcher({ path, method, body }: FetcherOptions): () => Promise<any> {
	const headers: HeadersInit = {};

	if (body && jsonMethods.has(method)) {
		headers['Content-Type'] = 'application/json';
	}

	return async () => {
		const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL!}${path}`, {
			method,
			body: body ? JSON.stringify(body) : (body as BodyInit),
			credentials: 'include',
			headers,
		});

		if (response.ok) {
			return response.json();
		}

		throw new APIError(await response.json(), method);
	};
}
