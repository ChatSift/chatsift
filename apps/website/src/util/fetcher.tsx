import type { Payload } from '@hapi/boom';
import Link from 'next/link';
import type { NextRouter } from 'next/router';
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
	error: unknown;
	hostUrl: string;
	router: NextRouter;
	toast: ToastFn;
}

export function fetcherErrorHandler({ router, error, toast, hostUrl }: FetcherErrorHandlerOptions) {
	console.log('error', error);

	if (error instanceof APIError) {
		switch (error.payload.statusCode) {
			case 401: {
				void router.push(URLS.API.LOGIN(hostUrl));
				return;
			}

			case 403:
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
		}
	}
}

export interface FetcherOptions {
	body?: unknown;
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
	path: string;
}

const jsonMethods = new Set(['POST', 'PUT', 'PATCH']);

export default async function fetcher({ path, method, body }: FetcherOptions): Promise<unknown> {
	const headers: HeadersInit = {};

	if (body && jsonMethods.has(method)) {
		headers['Content-Type'] = 'application/json';
	}

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
}
