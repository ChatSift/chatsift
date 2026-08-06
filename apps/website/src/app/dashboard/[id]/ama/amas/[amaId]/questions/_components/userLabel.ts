import type { APIUser, Snowflake } from 'discord-api-types/v10';

export function userLabel(user: APIUser | Snowflake): string {
	if (typeof user === 'string') {
		return user;
	}

	return user.global_name ?? `${user.username}${user.discriminator === '0' ? '' : `#${user.discriminator}`}`;
}
