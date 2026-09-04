import { getContext } from '@chatsift/backend-core';
import { computeChannelPermissions, PermissionsBitField } from '@chatsift/core';
import type { APIRole } from '@discordjs/core';
import { PermissionFlagsBits } from '@discordjs/core';

/**
 * Who the filters never act on, over and above the guild's bypass roles (added after P5).
 *
 * **The owner is not a preference.** Discord refuses every punishment against a guild owner, so a trigger
 * ladder rung on one is a guaranteed failure -- and until this existed the runners deleted the owner's
 * messages, DMed them about it, and counted them toward a rung nothing could ever carry out. `permissions.ts`
 * has said "You cannot action the server owner" since P1; it was only ever wired to the commands.
 *
 * **Staff are here because a bypass role is opt-in.** Nobody configures one before the first false positive,
 * and "our own anti-spam muted the mods" is the shape that complaint arrives in. Bypass roles keep the job
 * they are actually good at: naming somebody who is *not* staff and should still be left alone.
 *
 * Guild-level permissions only -- no channel overwrites. Resolving those means a `GET /channels/{id}` per
 * channel (and a thread's parent) on the path that runs for every message, to catch the rare moderator whose
 * Manage Messages comes from an overwrite rather than from a role. They can be given a bypass role.
 */
export type FilterImmunity = 'ADMINISTRATOR' | 'MANAGE_MESSAGES' | 'OWNER';

/**
 * How an immunity reads in the filter log, in the words a moderator reading it would use.
 */
export const IMMUNITY_SUMMARY: Record<FilterImmunity, string> = {
	OWNER: 'Skipped: the server owner is never filtered',
	ADMINISTRATOR: 'Skipped: administrators are never filtered',
	MANAGE_MESSAGES: 'Skipped: members with Manage Messages are never filtered',
};

interface GuildStaff {
	readonly ownerId: string;
	readonly roles: readonly Pick<APIRole, 'id' | 'permissions'>[];
}

/**
 * Process-local rather than redis, matching `automodRules.ts`: a few hundred bytes per guild, regenerated on
 * any miss, and a replica holding its own copy beats a network round trip to share one.
 *
 * Five minutes is the staleness a guild sees after editing a role's permissions or transferring ownership.
 * Both are rare, and the direction of the error is mild either way -- somebody stays immune slightly too long,
 * or is filtered slightly too long.
 */
const STAFF_TTL_MS = 5 * 60 * 1_000;

/**
 * Much shorter, because a failure is not an answer: a guild the bot momentarily could not read should recover
 * quickly, while still not issuing a request per message in the meantime.
 */
const FAILURE_TTL_MS = 60 * 1_000;

interface CacheEntry {
	readonly expiresAt: number;
	readonly staff: GuildStaff | null;
}

const cache = new Map<string, CacheEntry>();

/**
 * Exported for the tests. Deliberately not offered to `/simulate`, for the reasons `inviteFilter.ts` spells
 * out: the command reports what the runner would do, which means reading the cache the runner reads.
 */
export function clearFilterImmunityCache(): void {
	cache.clear();
}

async function loadGuildStaff(guildId: string): Promise<GuildStaff | null> {
	const cached = cache.get(guildId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.staff;
	}

	const context = getContext();

	try {
		const guild = await context.service.client.api.guilds.get(guildId);
		const staff: GuildStaff = {
			ownerId: guild.owner_id,
			roles: guild.roles.map((role) => ({ id: role.id, permissions: role.permissions })),
		};

		cache.set(guildId, { staff, expiresAt: Date.now() + STAFF_TTL_MS });
		return staff;
	} catch (error) {
		cache.set(guildId, { staff: null, expiresAt: Date.now() + FAILURE_TTL_MS });
		context.logger.warn({ err: error, guildId }, 'could not read a guild to check filter immunity');
		return null;
	}
}

/**
 * The status that keeps this member out of the filters, or `null` if nothing does.
 *
 * **Fails open**, the same direction and for the same reason as the bypass check: a guild we cannot read must
 * not silently exempt everybody. The cost is that the owner is filtered during an outage; the alternative is
 * that nobody is filtered during one.
 *
 * Takes the roles the caller already resolved rather than fetching them, matching `findBypassRole` -- both
 * gates run back to back off one resolution.
 */
export async function findFilterImmunity(
	guildId: string,
	userId: string,
	roleIds: readonly string[],
): Promise<FilterImmunity | null> {
	const staff = await loadGuildStaff(guildId);
	if (!staff) {
		return null;
	}

	// Before the computation below, which reports an owner as holding every permission there is -- the two are
	// the same verdict but not the same sentence, and the log says which.
	if (userId === staff.ownerId) {
		return 'OWNER';
	}

	const permissions = computeChannelPermissions({
		guildId,
		guildOwnerId: staff.ownerId,
		memberId: userId,
		memberRoleIds: roleIds,
		// Guild-level, per the note above. `@everyone` is the role whose id is the guild id, and the helper
		// already folds it in.
		overwrites: [],
		roles: staff.roles,
	});

	if (PermissionsBitField.any(permissions, PermissionFlagsBits.Administrator)) {
		return 'ADMINISTRATOR';
	}

	if (PermissionsBitField.any(permissions, PermissionFlagsBits.ManageMessages)) {
		return 'MANAGE_MESSAGES';
	}

	return null;
}
