'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { useCloseNavbarMobile } from '@chatsift/web-core/components/nav/NavbarMobile';
import { useRouter } from 'next/navigation';
import { useLogout } from '@/api/routes/appeals';

/**
 * The dashboard's `LogoutButton` without the parts that only it needs. Same ordering rule, and for the same
 * reason: the logout POST is awaited before navigating, so nothing can render a stale signed-in view off a
 * cookie that is still in the middle of being cleared.
 */
export function AppealsLogoutButton({ className }: { readonly className?: string }) {
	const logout = useLogout();
	const router = useRouter();
	const closeNavbarMobile = useCloseNavbarMobile();

	return (
		<Button
			className={className ?? ''}
			onPress={async () => {
				await logout.mutateAsync();
				router.replace('/');
				closeNavbarMobile();
			}}
			type="button"
		>
			<span className="text-primary dark:text-primary-dark">Log out</span>
		</Button>
	);
}
