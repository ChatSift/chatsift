import type { APIGuildMember, APIUser } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';

/**
 * Both a live gateway `MESSAGE_CREATE`/`MESSAGE_UPDATE` member payload (`APIGuildMemberNoUser`) and a
 * full REST-fetched `APIGuildMember` only ever need `avatar`/`nick` read here -- narrowed to just those
 * instead of requiring the full type, so either shape satisfies it.
 */
export type MemberLike = Pick<APIGuildMember, 'avatar' | 'nick'>;

/**
 * Global (non-guild-specific) avatar.
 */
export function resolveGlobalAvatarURL(user: APIUser): string | undefined {
	return user.avatar ? `${RouteBases.cdn}${CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.PNG)}` : undefined;
}

/**
 * Guild-preferring avatar: guild avatar if the member has one set, else falls back to the global one.
 */
export function resolveGuildAvatarURL(
	guildId: string,
	member: MemberLike | undefined,
	user: APIUser,
): string | undefined {
	if (member?.avatar) {
		return `${RouteBases.cdn}${CDNRoutes.guildMemberAvatar(guildId, user.id, member.avatar, ImageFormat.PNG)}`;
	}

	return resolveGlobalAvatarURL(user);
}
