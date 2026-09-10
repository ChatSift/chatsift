'use client';

import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { LoginButton } from '@chatsift/web-core/components/nav/LoginButton';
import { usePathname } from 'next/navigation';
import { AppealsLogoutButton } from './AppealsLogoutButton';
import { AppealsUserAvatar } from './AppealsUserAvatar';
import { loginHref, useMe } from '@/api/routes/appeals';

export function AppealsUserDesktop() {
	const { data: user, isPending } = useMe();
	const pathname = usePathname();

	if (isPending) {
		return <Skeleton className="h-10 w-20" />;
	}

	if (!user) {
		return <LoginButton href={loginHref(pathname)} />;
	}

	return (
		<div className="flex items-center space-x-4">
			<AppealsLogoutButton />
			<AppealsUserAvatar className="h-12 w-12 rounded-full" />
		</div>
	);
}
