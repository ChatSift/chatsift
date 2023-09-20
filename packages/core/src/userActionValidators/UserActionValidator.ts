import type { API, APIGuild, APIGuildMember, APIRole, APIUser } from '@discordjs/core';
import type { Kysely } from 'kysely';
import type { DB } from '../db';
import type {
	IUserActionValidator,
	UserActionValidatorContext,
	UserActionValidatorResult,
} from './IUserActionValidator';

export type UserActionValidatorTarget = APIGuildMember | APIUser | string;

function targetIsAPIGuildMember(target: UserActionValidatorTarget): target is APIGuildMember {
	return typeof target !== 'string' && 'roles' in target;
}

/**
 * Current implementation of our action validation, built to prevent re-fetching data as much as possible.
 */
export class UserActionValidator implements IUserActionValidator {
	private readonly guildId: string;

	private guild: APIGuild | null;

	/**
	 * @remarks
	 * We shhould always have the full moderator available.
	 */
	private readonly moderator: APIGuildMember;

	/**
	 * @remarks
	 * It's possible we could be dealing with a user that's not in the guild, or even potentially
	 * an account that no longer exists
	 */
	private readonly targetId: string;

	private target: APIGuildMember | APIUser | null;

	private guildRoles: APIRole[] | null;

	public constructor(
		private readonly api: API,
		private readonly db: Kysely<DB>,
		context: UserActionValidatorContext,
	) {
		this.guildId = typeof context.guild === 'string' ? context.guild : context.guild.id;

		this.guild = typeof context.guild === 'string' ? null : context.guild;

		this.moderator = context.moderator;

		if (typeof context.target === 'string') {
			this.targetId = context.target;
			this.target = null;
		} else {
			if (targetIsAPIGuildMember(context.target)) {
				this.targetId = context.target.user!.id;
			} else {
				this.targetId = context.target.id;
			}

			this.target = context.target;
		}

		this.guildRoles = context.guildRoles ?? null;
	}

	public async targetIsActionable(): Promise<UserActionValidatorResult> {
		if (!this.guildRoles) {
			this.guildRoles = await this.api.guilds.getRoles(this.guildId);
		}

		const target = await this.assertTarget();
		// This operation is redundant as null implies the user no longer exists,
		// but should probably go through anyway. We also have no extra state to update.
		if (!target) {
			return { ok: true };
		}

		// Target is not in the guild, role hiararchy does not apply.
		if (!targetIsAPIGuildMember(target)) {
			return { ok: true };
		}

		const guild = await this.assertGuild();

		const modRoles = await this.db.selectFrom('ModRole').select('roleId').where('guildId', '=', this.guildId).execute();
		const modRoleIds = modRoles.map((role) => role.roleId);

		// If the target is a moderator, they cannot be acted on.
		if (target.roles.some((role) => modRoleIds.includes(role))) {
			return { ok: false, reason: 'Target appears to be a moderator.' };
		}

		// If the moderator is the owner, they bypass all further role hierarchy checks.
		if (guild.owner_id === this.moderator.user!.id) {
			return { ok: true };
		}

		// If the target is the owner, they cannot be lower than the moderator.
		if (guild.owner_id === target.user!.id) {
			return { ok: false, reason: 'Target appears to be the owner of this guild.' };
		}

		// Mod cannot act on themselves
		if (this.moderator.user!.id === target.user!.id) {
			return { ok: false, reason: 'You cannot act on yourself.' };
		}

		const highestModeratorRole = await this.getHighestRoleForUser(this.moderator.roles);
		const highestTargetRole = await this.getHighestRoleForUser(target.roles);

		if (highestModeratorRole.position > highestTargetRole.position) {
			return { ok: true };
		}

		return { ok: false, reason: 'Target appears to have a higher role than you.' };
	}

	private async getHighestRoleForUser(roles: string[]): Promise<APIRole> {
		if (!this.guildRoles) {
			this.guildRoles = await this.api.guilds.getRoles(this.guildId);
		}

		const [role] = this.guildRoles.filter((role) => roles.includes(role.id)).sort((a, b) => b.position - a.position);
		return role!;
	}

	private async assertTarget(): Promise<APIGuildMember | APIUser | null> {
		if (this.target) {
			return this.target;
		}

		const user = await this.api.users.get(this.targetId).catch(() => null);
		// Assume the error is due to the user no longer existing.
		if (!user) {
			return null;
		}

		// Try to get the member from the guild. If it fails, assume the user is not in the guild.
		const member = await this.api.guilds.getMember(this.guildId, this.targetId).catch(() => null);

		// Update our state
		this.target = member ?? user;
		return member ?? user;
	}

	private async assertGuild(): Promise<APIGuild> {
		if (this.guild) {
			return this.guild;
		}

		const guild = await this.api.guilds.get(this.guildId);
		this.guild = guild;
		return guild;
	}
}
