import type { Logger } from '@chatsift/backend-core';
import type { API, APIRole, Snowflake } from '@discordjs/core';
import { badRequest, internal } from '@hapi/boom';
import { createCachedGuildFetcher } from './guildDataCache.js';

export type GuildRoleInfo = Pick<APIRole, 'color' | 'id' | 'managed' | 'name' | 'position'>;

async function fetchGuildRolesRaw(guildId: string, api: API): Promise<GuildRoleInfo[]> {
	const rolesRaw = await api.guilds.getRoles(guildId);

	// The `@everyone` role (id === guildId) is never a sensible "alert role" target -- drop it here so every
	// consumer (validation, the dashboard's role picker) doesn't need to special-case it.
	return rolesRaw
		.filter((role) => role.id !== guildId)
		.map(({ id, name, color, position, managed }) => ({ id, name, color, position, managed }));
}

const rolesFetcher = createCachedGuildFetcher(fetchGuildRolesRaw);

export function clearCache() {
	rolesFetcher.clearCache();
}

export async function fetchGuildRoles(guildId: string, api: API, force = false): Promise<GuildRoleInfo[] | null> {
	return rolesFetcher.fetch(guildId, api, force);
}

/**
 * Guards against a guild manager pointing a role field (e.g. ModMail's `alertRoleId`) at a role that belongs to a
 * different guild -- mirrors `channels.ts`'s `assertChannelsBelongToGuild`.
 */
export async function assertRolesBelongToGuild(
	guildId: Snowflake,
	roleIds: (Snowflake | null | undefined)[],
	api: API,
	logger: Logger,
): Promise<void> {
	// eslint-disable-next-line unicorn/prefer-native-coercion-functions
	const ids = roleIds.filter((id): id is Snowflake => Boolean(id));
	if (!ids.length) {
		return;
	}

	const roles = await fetchGuildRoles(guildId, api);
	if (!roles) {
		logger.warn({ guildId }, `Failed to fetch roles for guild ${guildId}`);
		throw internal();
	}

	const validIds = new Set(roles.map((role) => role.id));
	for (const id of ids) {
		if (!validIds.has(id)) {
			throw badRequest(`role ${id} does not belong to this guild`);
		}
	}
}
