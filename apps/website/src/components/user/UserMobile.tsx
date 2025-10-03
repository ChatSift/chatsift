'use client';

import { LoginButton } from './LoginButton';
import { LogoutButton } from './LogoutButton';
import { UserAvatarMe } from './UserAvatarMe';
import { UserErrorHandler } from './UserErrorHandler';
import { client } from '@/data/client';

interface UserMobileProps {
	// eslint-disable-next-line @typescript-eslint/method-signature-style
	readonly setMobileNavOpen: (open: boolean) => void;
}

export function UserMobile({ setMobileNavOpen }: UserMobileProps) {
	const { data: user, error } = client.auth.useMe();

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
			<LogoutButton
				additionally={() => setMobileNavOpen(false)}
				className="ml-auto text-secondary dark:text-secondary-dark"
			/>
		</div>
	);
}
