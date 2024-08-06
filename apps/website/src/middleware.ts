import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { server } from '~/data/server';
import { URLS } from '~/util/constants';

export async function middleware(request: NextRequest) {
	const user = await server.me.fetch().catch(() => null);

	if (!user) {
		return NextResponse.redirect(new URL(URLS.API.LOGIN, request.url));
	}
}

export const config = {
	matcher: '/dashboard/:path*',
};
