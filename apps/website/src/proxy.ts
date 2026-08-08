import { RefreshTokenCookie } from '@chatsift/core';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { URLS } from './utils/urls';

export async function proxy(request: NextRequest) {
	if (!request.cookies.has(RefreshTokenCookie)) {
		const redirectTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
		return NextResponse.redirect(new URL(URLS.API.login(redirectTo), request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: '/dashboard/:path*',
};
