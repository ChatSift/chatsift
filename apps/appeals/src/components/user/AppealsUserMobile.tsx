'use client';

import { LoginButton } from '@chatsift/web-core/components/nav/LoginButton';
import { usePathname } from 'next/navigation';
import { AppealsLogoutButton } from './AppealsLogoutButton';
import { AppealsUserAvatar } from './AppealsUserAvatar';
import { loginHref, useMe } from '@/api/routes/appeals';

export function AppealsUserMobile() {
	const { data: user } = useMe();
	const pathname = usePathname();

	if (!user) {
		return <LoginButton href={loginHref(pathname)} />;
	}

	return (
		<div className="flex flex-row items-center gap-4">
			<AppealsUserAvatar className="h-10 w-10 rounded-full" />
			<p className="text-base font-medium">{user.displayName}</p>
			<AppealsLogoutButton className="ml-auto text-secondary dark:text-secondary-dark" />
		</div>
	);
}
