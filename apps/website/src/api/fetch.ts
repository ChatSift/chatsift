import { NewAccessTokenHeader, RefreshTokenCookie } from '@chatsift/core';
import type { DehydratedState } from '@tanstack/react-query';
import type { ZodErrorTree } from './error';
import { APIError } from './error';
import { clearCachedAccessToken, getCachedAccessToken, setCachedAccessToken } from './serverTokenCache';
import { store } from './store';
import { accessTokenAtom } from './token';

function getBaseURL(): string {
	return process.env['NEXT_PUBLIC_API_URL']!;
}

export interface FetchOptions {
	body?: unknown;
	headers?: Record<string, string>;
	query?: Record<string, boolean | number | string | undefined>;
}

function buildURL(path: string, query?: FetchOptions['query']): string {
	const url = new URL(path, getBaseURL());
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined) {
				url.searchParams.set(key, String(value));
			}
		}
	}

	return url.toString();
}

async function parseError(response: Response): Promise<APIError> {
	try {
		const data = (await response.json()) as {
			error: string;
			// Present (via `sendBoom`'s `treeifyError` spread) only on a zod-validation 400 — all three keys are
			// only ever present together, spread directly from `treeifyError()`'s root node.
			errors?: string[];
			items?: ZodErrorTree[];
			message: string;
			properties?: Record<string, ZodErrorTree>;
			statusCode: number;
		};

		const hasValidationErrors = data.errors !== undefined || data.properties !== undefined || data.items !== undefined;
		const validationErrors: ZodErrorTree | undefined = hasValidationErrors
			? { errors: data.errors ?? [], properties: data.properties, items: data.items }
			: undefined;

		return new APIError(data.statusCode, data.error, data.message, validationErrors);
	} catch (error) {
		console.error('failed to parse error response', {
			status: response.status,
			statusText: response.statusText,
			error,
		});
		return new APIError(response.status, response.statusText, 'An unexpected error occurred');
	}
}

async function parseSuccess<TResponse>(response: Response): Promise<TResponse> {
	// Some routes intentionally respond with an empty body on a 200 (rather than a 204) — fall back on the
	// Content-Type header instead of the status code to decide whether there's anything to parse.
	if (!response.headers.get('content-type')?.startsWith('application/json')) {
		return undefined as TResponse;
	}

	return response.json() as Promise<TResponse>;
}

async function apiFetchClient<TResponse>(method: string, path: string, options: FetchOptions): Promise<TResponse> {
	const accessToken = store.get(accessTokenAtom);

	const headers: Record<string, string> = {
		...(options.body !== undefined && { 'Content-Type': 'application/json' }),
		// The API expects the bare JWT here, not a `Bearer `-prefixed scheme.
		...(accessToken && { Authorization: accessToken }),
		...options.headers,
	};

	const response = await fetch(buildURL(path, options.query), {
		method: method.toUpperCase(),
		headers,
		credentials: 'include',
		...(options.body !== undefined && { body: JSON.stringify(options.body) }),
	});

	const newToken = response.headers.get(NewAccessTokenHeader);
	if (newToken) {
		store.set(accessTokenAtom, newToken === 'noop' ? null : newToken);
	}

	if (!response.ok) {
		throw await parseError(response);
	}

	return parseSuccess<TResponse>(response);
}

async function apiFetchServer<TResponse>(method: string, path: string, options: FetchOptions): Promise<TResponse> {
	// Dynamic import keeps next/headers out of the client bundle without having to split this file
	const { cookies } = await import('next/headers');
	const cookieStore = await cookies();

	const refreshToken = cookieStore.get(RefreshTokenCookie)?.value;
	const cachedAccessToken = refreshToken ? getCachedAccessToken(refreshToken) : null;

	const cookieHeader = cookieStore
		.getAll()
		.map((c) => `${c.name}=${c.value}`)
		.join('; ');

	const headers: Record<string, string> = {
		...(options.body !== undefined && { 'Content-Type': 'application/json' }),
		...(cachedAccessToken && { Authorization: cachedAccessToken }),
		...(cookieHeader && { Cookie: cookieHeader }),
		...options.headers,
	};

	const response = await fetch(buildURL(path, options.query), {
		method: method.toUpperCase(),
		headers,
		cache: 'no-store',
		...(options.body !== undefined && { body: JSON.stringify(options.body) }),
	});

	const newToken = response.headers.get(NewAccessTokenHeader);
	if (refreshToken && newToken) {
		if (newToken === 'noop') {
			clearCachedAccessToken(refreshToken);
		} else {
			setCachedAccessToken(refreshToken, newToken);
		}
	}

	if (!response.ok) {
		throw await parseError(response);
	}

	return parseSuccess<TResponse>(response);
}

/**
 * Unified API fetch utility. Automatically routes to the server or client implementation based on execution
 * environment.
 *
 * - **Server** (SSR/RSC): forwards cookies, reads/writes the server-side access token cache, uses
 *   `cache: 'no-store'`.
 * - **Client**: reads `accessTokenAtom`, sends `credentials: 'include'`, updates the atom from the
 *   access-token-refresh response header.
 *
 * Throws `APIError` on non-2xx responses.
 */
export async function apiFetch<TResponse = void>(
	method: string,
	path: string,
	options: FetchOptions = {},
): Promise<TResponse> {
	if (typeof window === 'undefined') {
		return apiFetchServer<TResponse>(method, path, options);
	}

	return apiFetchClient<TResponse>(method, path, options);
}

export async function prefetch(
	prefetchFns: { queryFn(): Promise<any>; queryKey(): readonly unknown[] }[],
): Promise<DehydratedState> {
	// Dynamic import keeps react-query out of the client bundle without having to split this file
	const { dehydrate, QueryClient } = await import('@tanstack/react-query');
	const queryClient = new QueryClient();

	const calls = prefetchFns.map(async ({ queryFn, queryKey }) => {
		try {
			await queryClient.fetchQuery({ queryKey: queryKey(), queryFn });
		} catch (error) {
			// A failed prefetch must never take the page down with it — this runs in server components, often in
			// a root/shared layout, so an unhandled rejection here would 500 every route under it, not just the
			// one that wanted this data. `dehydrate` below only ever includes queries in a `success` state by
			// default, so simply swallowing the rejection here is enough: this query is left out of the dehydrated
			// state, and the client transparently falls back to fetching (and error-handling) it itself on mount.
			console.error('prefetch failed', { queryKey: queryKey(), error });
		}
	});
	await Promise.all(calls);

	return dehydrate(queryClient);
}
