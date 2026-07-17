'use client';

import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { FaExclamationTriangle, FaTimes } from 'react-icons/fa';
import { dismissErrorBanner, errorBannerMessagesAtom } from '@/api/errorBanner';

const AUTO_DISMISS_MS = 8_000;

function Banner({ id, message }: { readonly id: number; readonly message: string }) {
	useEffect(() => {
		const timeout = setTimeout(() => dismissErrorBanner(id), AUTO_DISMISS_MS);
		return () => clearTimeout(timeout);
	}, [id]);

	return (
		<div className="flex items-center gap-3 rounded-lg border-[1px] border-misc-danger bg-card p-3 shadow-lg dark:bg-card-dark">
			<FaExclamationTriangle className="h-4 w-4 shrink-0 text-misc-danger" />
			<p className="text-sm text-primary dark:text-primary-dark">{message}</p>
			<button
				aria-label="Dismiss"
				className="ml-auto text-secondary hover:text-primary dark:text-secondary-dark dark:hover:text-primary-dark"
				onClick={() => dismissErrorBanner(id)}
				type="button"
			>
				<FaTimes className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}

/**
 * Surfaces background query failures (a refetch that failed while stale data is still on screen — see
 * `queryClient.ts`'s `onError`). First-load errors are handled locally by `UserErrorHandler` instead, so this
 * only needs to catch the "user is already looking at data and something broke quietly" case.
 */
export function ErrorBanner() {
	const banners = useAtomValue(errorBannerMessagesAtom);

	if (banners.length === 0) {
		return null;
	}

	return (
		<div className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2" role="status">
			{banners.map((banner) => (
				<Banner id={banner.id} key={banner.id} message={banner.message} />
			))}
		</div>
	);
}
