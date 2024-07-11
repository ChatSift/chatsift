import type { APIUser, DefaultUserAvatarAssets, Snowflake } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RouteBases, type UserAvatarFormat } from '@discordjs/core';

export function computeAvatarFormat<TFormat extends UserAvatarFormat>(
	avatarHash: string,
	format: TFormat,
): ImageFormat.GIF | TFormat {
	return avatarHash.startsWith('a_') ? ImageFormat.GIF : format;
}

// New as in, Discord's new username system
export function computeDefaultAvatarIndexNew(userId: Snowflake): DefaultUserAvatarAssets {
	const big = BigInt(userId);
	return Number((big >> 22n) % 6n) as DefaultUserAvatarAssets;
}

export function computeDefaultAvatarIndexOld(discriminator: string): DefaultUserAvatarAssets {
	return (Number.parseInt(discriminator, 10) % 5) as DefaultUserAvatarAssets;
}

export function computeDefaultAvatarIndex(user: APIUser | null, userId: Snowflake): DefaultUserAvatarAssets {
	if (!user) {
		return computeDefaultAvatarIndexNew(userId);
	}

	if (user.global_name) {
		return computeDefaultAvatarIndexNew(userId);
	}

	return computeDefaultAvatarIndexOld(user.discriminator);
}

export function computeAvatarUrl(user: APIUser | null, userId: Snowflake): string {
	// Use the default avatar
	if (!user?.avatar) {
		return `${RouteBases.cdn}${CDNRoutes.defaultUserAvatar(computeDefaultAvatarIndexNew(userId))}`;
	}

	const format = computeAvatarFormat(user.avatar, ImageFormat.PNG);
	return `${RouteBases.cdn}${CDNRoutes.userAvatar(userId, user.avatar, format)}`;
}
