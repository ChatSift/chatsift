'use client';

import { useCloseNavbarMobile } from '@chatsift/web-core/components/nav/NavbarMobile';
import { LoginButton } from './LoginButton';
import { LogoutButton } from './LogoutButton';
import { UserAvatarMe } from './UserAvatarMe';
import { UserErrorHandler } from './UserErrorHandler';
import { useMe } from '@/api/routes/auth';

export function UserMobile() {
	const { data: user, error } = useMe();
	const closeNavbarMobile = useCloseNavbarMobile();

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (!user) {
		return <LoginButton />;
	}

	return (
		<div className="flex flex-row items-center gap-4">
			<UserAvatarMe className="h-10 w-10 rounded-full" />
			<p className="text-base font-medium">{user.username}</p>
			<LogoutButton additionally={closeNavbarMobile} className="ml-auto text-secondary dark:text-secondary-dark" />
		</div>
	);
}
