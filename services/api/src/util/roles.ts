import { setTimeout, clearTimeout } from 'node:timers';
import type { Logger } from '@chatsift/backend-core';
import type { API, APIRole, Snowflake } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badRequest, internal } from '@hapi/boom';

export type GuildRoleInfo = Pick<APIRole, 'color' | 'id' | 'managed' | 'name' | 'position'>;

// Mirrors `channels.ts`'s in-memory cache -- see its `TODO(DD)` about moving this to redis.
const CACHE = new Map<Snowflake, GuildRoleInfo[]>();
const CACHE_TIMEOUTS = new Map<string, NodeJS.Timeout>();
const CACHE_TTL = 5 * 60 * 1_000; // 5 minutes

export function clearCache() {
	CACHE.clear();
	for (const timeout of CACHE_TIMEOUTS.values()) {
		clearTimeout(timeout);
	}

	CACHE_TIMEOUTS.clear();
}

export async function fetchGuildRoles(guildId: string, api: API, force = false): Promise<GuildRoleInfo[] | null> {
	if (CACHE.has(guildId) && !force) {
		return CACHE.get(guildId)!;
	}

	const rolesRaw = await api.guilds.getRoles(guildId).catch((error) => {
		if (error instanceof DiscordAPIError && (error.status === 403 || error.status === 404)) {
			return null;
		}

		throw error;
	});

	if (!rolesRaw) {
		return null;
	}

	// The `@everyone` role (id === guildId) is never a sensible "alert role" target -- drop it here so every
	// consumer (validation, the dashboard's role picker) doesn't need to special-case it.
	const roles: GuildRoleInfo[] = rolesRaw
		.filter((role) => role.id !== guildId)
		.map(({ id, name, color, position, managed }) => ({ id, name, color, position, managed }));

	CACHE.set(guildId, roles);
	if (CACHE_TIMEOUTS.has(guildId)) {
		const timeout = CACHE_TIMEOUTS.get(guildId)!;
		timeout.refresh();
	} else {
		const timeout = setTimeout(() => {
			CACHE.delete(guildId);
			CACHE_TIMEOUTS.delete(guildId);
		}, CACHE_TTL).unref();

		CACHE_TIMEOUTS.set(guildId, timeout);
	}

	return roles;
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
