import type { APIEmbedAuthor, APIEmbedFooter, APIUser, Snowflake } from 'discord-api-types/v10';
import { computeAvatarUrl } from './computeAvatar.js';

export function userToEmbedAuthor(user: APIUser | null, userId: Snowflake): APIEmbedAuthor {
	return {
		name: `${user?.username ?? '[Unknown/Deleted user]'} (${userId})`,
		icon_url: computeAvatarUrl(user, userId),
	};
}

export function userToEmbedFooter(user: APIUser | null, userId: Snowflake): APIEmbedFooter {
	return {
		text: `${user?.username ?? '[Unknown/Deleted user]'} (${userId})`,
		icon_url: computeAvatarUrl(user, userId),
	};
}
