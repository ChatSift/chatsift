'use client';

import { LoginButton } from './LoginButton';
import { LogoutButton } from './LogoutButton';
import { UserAvatarMe } from './UserAvatarMe';
import { UserErrorHandler } from './UserErrorHandler';
import { client } from '@/data/client';

export function UserDesktop() {
	const { data: user, error } = client.auth.useMe();

	if (error) {
		return <UserErrorHandler error={error} />;
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
