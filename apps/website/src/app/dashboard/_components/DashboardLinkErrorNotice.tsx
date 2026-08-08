'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { pushErrorBanner } from '@/api/errorBanner';

const MESSAGES = {
	expired: 'That /dashboard link expired (links only last 2 minutes) - run /dashboard again for a new one.',
	used: 'That /dashboard link has already been used - run /dashboard again for a new one.',
	forbidden: "You don't have permission to manage that server.",
	unavailable: 'Something went wrong opening that /dashboard link. Please try again in a moment.',
} as const;

/**
 * Surfaces `GET /v3/auth/dashboard`'s (`services/api/src/routes/auth/dashboardLink.ts`) failure bounces --
 * it 302s here with `?dashboard_link_error=...` rather than a JSON body, since the exchange happens outside
 * any page the user is looking at. Renders nothing itself; pushes a dismissible toast (`ErrorBanner`, mounted
 * globally in `Providers`) and strips the query param so a refresh doesn't re-fire it.
 */
export function DashboardLinkErrorNotice() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const handled = useRef(false);

	const error = searchParams.get('dashboard_link_error');

	useEffect(() => {
		if (!error || handled.current) {
			return;
		}

		handled.current = true;
		pushErrorBanner(error in MESSAGES ? MESSAGES[error as keyof typeof MESSAGES] : MESSAGES.unavailable);
		router.replace(pathname);
	}, [error, pathname, router]);

	return null;
}
