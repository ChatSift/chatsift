'use client';

import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { LoginButton } from './LoginButton';
import { LogoutButton } from './LogoutButton';
import { UserAvatarMe } from './UserAvatarMe';
import { UserErrorHandler } from './UserErrorHandler';
import { useMe } from '@/api/routes/auth';

export function UserDesktop() {
	const { data: user, error, isLoading } = useMe();

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return <Skeleton className="w-20 h-10" />;
	}

	if (!user) {
		return <LoginButton />;
	}

	return (
		<div className="flex items-center space-x-4">
			<LogoutButton />
			<UserAvatarMe className="h-12 w-12 rounded-full" />
		</div>
	);
}
