'use client';

import { GenericAvatar } from '@chatsift/web-core/components/GenericAvatar';
import type { DefaultUserAvatarAssets } from 'discord-api-types/v10';
import { CDNRoutes, ImageFormat, RouteBases } from 'discord-api-types/v10';
import { useMe } from '@/api/routes/appeals';

/**
 * The signed-in appellant's avatar, resolving the same way `apps/website`'s `UserAvatar` does -- including the
 * Discord default when the account has no custom one, rather than falling back to initials, so the two navbars
 * render the same thing for the same account.
 */
export function AppealsUserAvatar({ className }: { readonly className: string }) {
	const { data: user, isPending } = useMe();

	if (!user) {
		return null;
	}

	const assetURL = user.avatarUrl
		? user.avatarUrl
		: `${RouteBases.cdn}${CDNRoutes.defaultUserAvatar(Number((BigInt(user.id) >> 22n) % 6n) as DefaultUserAvatarAssets)}`;

	return (
		<GenericAvatar assetURL={assetURL} className={className} disableLink initials="not needed" isLoading={isPending} />
	);
}
