import { RefreshTokenCookie } from '@chatsift/core';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isSocialCrawler } from './utils/crawlers';
import { URLS } from './utils/urls';

export async function proxy(request: NextRequest) {
	if (!request.cookies.has(RefreshTokenCookie)) {
		// A link unfurler has no session and never will, so redirecting it to Discord OAuth meant every
		// dashboard link pasted anywhere unfurled as discord.com's embed instead of ours (#295). Letting it
		// through is safe: this redirect is a UX convenience, not the security boundary -- the API is. Every
		// byte of real content under /dashboard comes from client-side authenticated calls a crawler can't
		// make and doesn't execute, so all it gets is the logged-out shell plus the route's metadata.
		if (isSocialCrawler(request.headers.get('user-agent'))) {
			return NextResponse.next();
		}

		const redirectTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
		return NextResponse.redirect(new URL(URLS.API.login(redirectTo), request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: '/dashboard/:path*',
};
