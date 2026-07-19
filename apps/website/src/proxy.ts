import { RefreshTokenCookie } from '@chatsift/core';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { URLS } from './utils/urls';

/**
 * The one route that accepts a one-time grant token (`?token=...`) in place of a session -- see `useGrantAuth()`
 * in `api/grant.ts`. Kept in sync with that hook's route regex. Only a `token` param's *presence* is checked here
 * (this is edge middleware, it doesn't have `ENCRYPTION_KEY` to verify the JWT signature) -- that's fine, this
 * check only decides whether to render the page or bounce to OAuth login, it grants no actual data access. Every
 * real request the page goes on to make is independently re-verified server-side by `isAuthed`'s `grants` option.
 */
const GRANT_EXEMPT_ROUTE = /^\/dashboard\/\d+\/ama\/amas\/new\/?$/;

export async function proxy(request: NextRequest) {
	const cookies = request.cookies;

	const hasGrantToken =
		GRANT_EXEMPT_ROUTE.test(request.nextUrl.pathname) && request.nextUrl.searchParams.has('token');

	if (!cookies.has(RefreshTokenCookie) && !hasGrantToken) {
		return NextResponse.redirect(new URL(URLS.API.LOGIN, request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: '/dashboard/:path*',
};
