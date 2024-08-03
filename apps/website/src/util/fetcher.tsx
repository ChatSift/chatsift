'use client';

import type { Payload } from '@hapi/boom';

export class APIError extends Error {
	public constructor(
		public readonly payload: Payload,
		public readonly method: string,
	) {
		super(payload.message);
	}
}

export interface FetcherErrorHandlerOptions {
	throwOverride?: boolean;
}

export function clientSideErrorHandler({ throwOverride }: FetcherErrorHandlerOptions): (error: Error) => boolean {
	return (error) => {
		if (error instanceof APIError) {
			if (error.payload.statusCode === 401 || error.payload.statusCode === 403) {
				return throwOverride ?? false;
			}

			if (error.payload.statusCode >= 500 && error.payload.statusCode < 600) {
				return throwOverride ?? true;
			}
		}

		return throwOverride ?? true;
	};
}

export interface FetcherOptions {
	body?: unknown;
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
	path: `/${string}`;
}

const jsonMethods = new Set(['POST', 'PUT', 'PATCH']);

export default function clientSideFetcher({ path, method, body }: FetcherOptions): () => Promise<any> {
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
