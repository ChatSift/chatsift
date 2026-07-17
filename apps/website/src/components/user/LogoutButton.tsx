'use client';

import { useRouter } from 'next/navigation';
import { Button } from '../common/Button';
import { useLogout } from '@/api/routes/auth';

interface LogoutButtonProps {
	// eslint-disable-next-line @typescript-eslint/method-signature-style
	readonly additionally?: () => void;
	readonly className?: string;
}

export function LogoutButton({ className, additionally }: LogoutButtonProps) {
	const logoutMutation = useLogout();
	const router = useRouter();

	return (
		<Button
			className={className ?? ''}
			onPress={async () => {
				// Await the actual logout call (clears cookies server-side) before navigating — if this navigated
				// first, `/`'s SSR fetch of `/v3/auth/me` (dynamic, cookie-dependent) could race ahead of the
				// still-in-flight logout POST and hydrate the client with stale "still logged in" data. See
				// `useLogout`'s `onSuccess` for why the post-logout cache clear doesn't reintroduce that same
				// class of race in the other direction (NavGateProvider redirecting to Discord before we navigate).
				await logoutMutation.mutateAsync();
				router.replace('/');
				additionally?.();
			}}
			type="button"
		>
			<span className="text-primary dark:text-primary-dark">Log out</span>
		</Button>
	);
}
