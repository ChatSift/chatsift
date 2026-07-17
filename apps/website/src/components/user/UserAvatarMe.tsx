'use client';

import { UserAvatar } from './UserAvatar';
import { useMe } from '@/api/routes/auth';

interface UserAvatarMeProps {
	readonly className: string;
}

export function UserAvatarMe({ className }: UserAvatarMeProps) {
	const { isLoading, data: user } = useMe();

	if (user === null) {
		return null;
	}

	return <UserAvatar className={className} isLoading={isLoading} user={user!} />;
}
