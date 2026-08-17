import type { APIUser, Snowflake } from '@discordjs/core';

export function snapshotUserLabel(resolved: APIUser | Snowflake, storedTag: string | null): string {
	if (storedTag) {
		return storedTag;
	}

	if (typeof resolved === 'string') {
		return resolved;
	}

	return resolved.global_name ?? resolved.username;
}

export function resolvedUserAvatar(user: APIUser | Snowflake): { avatar: string | null; id: string } | null {
	return typeof user === 'string' ? null : { avatar: user.avatar, id: user.id };
}
