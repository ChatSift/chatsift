import type { DefaultUserAvatarAssets, APIUser } from 'discord-api-types/v10';
import { CDNRoutes, ImageFormat, RouteBases } from 'discord-api-types/v10';
import { GenericAvatar } from '../common/GenericAvatar';

interface UserAvatarProps {
	readonly className: string;
	readonly isLoading: boolean;
	readonly user: APIUser | undefined;
}

export function UserAvatar({ className, isLoading, user }: UserAvatarProps) {
	const assetURL = user?.avatar
		? `${RouteBases.cdn}${CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.PNG)}`
		: `${RouteBases.cdn}${CDNRoutes.defaultUserAvatar(Number((BigInt(user?.id ?? '0') >> 22n) % 6n) as DefaultUserAvatarAssets)}`;

	return (
		<GenericAvatar
			assetURL={assetURL}
			className={className}
			disableLink
			href="/dummy"
			initials="not needed"
			isLoading={isLoading}
		/>
	);
}
