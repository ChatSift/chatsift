// TODO: Guild level auth methinks
// TODO: 5xx?
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { server } from '@/data/server';
import { URLS } from '@/utils/urls';

export async function middleware(request: NextRequest) {
	const user = await server.auth.me.fetch();

	if (!user.data) {
		// return NextResponse.redirect(new URL(URLS.API.LOGIN, request.url));
	}
}

export const config = {
	matcher: '/dashboard/:path*',
};
