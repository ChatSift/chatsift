'use client';

import { UserAvatar } from './UserAvatar';
import { client } from '@/data/client';

interface UserAvatarMeProps {
	readonly className: string;
}

export function UserAvatarMe({ className }: UserAvatarMeProps) {
	const { isLoading, data: user } = client.auth.useMe();

	if (user === null) {
		return null;
	}

	return <UserAvatar className={className} isLoading={isLoading} user={user!} />;
}
