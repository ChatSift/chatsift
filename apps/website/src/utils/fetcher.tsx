'use client';

import { NewAccessTokenHeader } from '@chatsift/core';
import type { Payload } from '@hapi/boom';
import { useCallback, useState } from 'react';

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
		console.error(error);
		if (throwOverride !== undefined) {
			return throwOverride;
		}

		if (error instanceof APIError) {
			if (error.payload.statusCode === 401 || error.payload.statusCode === 403) {
				return false;
			}

			if (error.payload.statusCode >= 500 && error.payload.statusCode < 600) {
				return true;
			}
		}

		return true;
	};
}

export interface FetcherOptions {
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
	path: `/${string}`;
}

const jsonMethods = new Set(['POST', 'PUT', 'PATCH']);

export function useClientSideFetcher({ path, method }: FetcherOptions): (body?: unknown) => Promise<any> {
	const [accessToken, setAccessToken] = useState<string | null>(null);
	return useCallback(
		async (body) => {
			let jsonBody = false;
			const headers: HeadersInit = {};

			if (body) {
				if (body instanceof FormData) {
					// Let the browser handle it
				} else if (jsonMethods.has(method)) {
					jsonBody = true;
					headers['Content-Type'] = 'application/json';
				}
			}

			if (accessToken) {
				// eslint-disable-next-line @typescript-eslint/dot-notation
				headers['Authorization'] = accessToken;
			}

			const response = await fetch(`${process.env['NEXT_PUBLIC_API_URL']!}${path}`, {
				method,
				body: (body ? (jsonBody ? JSON.stringify(body) : body) : undefined) as BodyInit,
				credentials: 'include',
				headers,
			});

			if (response.headers.has(NewAccessTokenHeader)) {
				const newAccessToken = response.headers.get(NewAccessTokenHeader);
				if (newAccessToken === 'noop') {
					setAccessToken(null);
				} else {
					setAccessToken(newAccessToken);
				}
			}

			if (response.ok) {
				// No content
				if (!response.headers.get('Content-Type')?.startsWith('application/json')) {
					return;
				}

				return response.json();
			}

			throw new APIError(await response.json(), method);
		},
		[accessToken, method, path],
	);
}
