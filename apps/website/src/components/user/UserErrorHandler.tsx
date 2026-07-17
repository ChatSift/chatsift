import { FaExclamationTriangle } from 'react-icons/fa';
import { LoginButton } from './LoginButton';
import { APIError } from '@/api/error';

/**
 * Handles the first-load error state for `useMe()` consumers (`NavGateProvider`, `UserDesktop`, `UserMobile`) —
 * no cached user data exists yet, so there's nothing to keep showing underneath. Background refetch failures
 * (data already on screen) go through the global `ErrorBanner` instead (see `queryClient.ts`'s `onError`).
 */
export function UserErrorHandler({ error }: { readonly error: Error }) {
	if (error instanceof APIError && error.statusCode === 401) {
		return <LoginButton />;
	}

	console.error(error);
	return (
		<div className="flex w-full flex-col items-center gap-2 rounded-lg border-[1px] border-misc-danger bg-card p-8 text-center dark:bg-card-dark">
			<FaExclamationTriangle className="h-8 w-8 text-misc-danger" />
			<p className="text-lg font-medium text-primary dark:text-primary-dark">Something went wrong</p>
			<p className="text-sm text-secondary dark:text-secondary-dark">
				{error instanceof APIError ? error.message : 'Please try refreshing the page.'}
			</p>
		</div>
	);
}
