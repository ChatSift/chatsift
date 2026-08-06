import type { DefaultUserAvatarAssets, APIUser, Snowflake } from 'discord-api-types/v10';
import { CDNRoutes, ImageFormat, RouteBases } from 'discord-api-types/v10';
import { userLabel } from './userLabel';
import { GenericAvatar } from '@/components/common/GenericAvatar';

interface AuthorAvatarProps {
	readonly className?: string;
	readonly user: APIUser | Snowflake;
}

/**
 * `question.author`/`extraAskers[].author` resolve to a bare `Snowflake` (see `resolveAmaUser`'s 404
 * fallback in `services/api/src/routes/ama/questions/util.ts`) when the user can no longer be fetched
 * from Discord -- still enough to compute Discord's own id-based default avatar, just without a real
 * avatar hash to prefer.
 */
export function AuthorAvatar({ user, className = 'h-6 w-6 rounded-full' }: AuthorAvatarProps) {
	const id = typeof user === 'string' ? user : user.id;
	const assetURL =
		typeof user === 'object' && user.avatar
			? `${RouteBases.cdn}${CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.PNG)}`
			: `${RouteBases.cdn}${CDNRoutes.defaultUserAvatar(Number((BigInt(id) >> 22n) % 6n) as DefaultUserAvatarAssets)}`;

	return (
		<GenericAvatar
			assetURL={assetURL}
			className={className}
			disableLink
			href="/dummy"
			initials={userLabel(user).slice(0, 2)}
			isLoading={false}
		/>
	);
}
