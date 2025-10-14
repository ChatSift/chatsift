import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { URLS } from './utils/urls';

export async function middleware(request: NextRequest) {
	const cookies = request.cookies;

	if (!cookies.has('refresh_token')) {
		return NextResponse.redirect(new URL(URLS.API.LOGIN, request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: '/dashboard/:path*',
};
