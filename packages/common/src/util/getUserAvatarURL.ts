import type { APIUser, DefaultUserAvatarAssets } from 'discord-api-types/v10';
import { CDNRoutes, ImageFormat, RouteBases } from 'discord-api-types/v10';

export function getUserAvatarURL(user?: APIUser | null) {
	if (!user) {
		return;
	}

	const path = user.avatar
		? CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.WebP)
		: CDNRoutes.defaultUserAvatar((Number.parseInt(user.discriminator, 10) % 5) as DefaultUserAvatarAssets);

	return `${RouteBases.cdn}${path}` as const;
}
