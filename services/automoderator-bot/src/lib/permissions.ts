import { getContext } from '@chatsift/backend-core';
import { getSelfId } from '@chatsift/bot-core';
import { PermissionsBitField } from '@chatsift/core';
import type { APIGuild, APIGuildMember, APIInteractionGuildMember, Snowflake } from '@discordjs/core';
import { PermissionFlagsBits } from '@discordjs/core';

export type HierarchyVerdict = { ok: false; reason: string } | { ok: true };

export type HierarchyMember = Pick<APIGuildMember, 'roles'>;

const OK: HierarchyVerdict = { ok: true };

function highestPosition(roleIds: readonly Snowflake[], guild: APIGuild): number {
	let highest = 0;

	for (const roleId of roleIds) {
		const role = guild.roles.find((candidate) => candidate.id === roleId);
		if (role && role.position > highest) {
			highest = role.position;
		}
	}

	return highest;
}

export interface HierarchyCheckOptions {
	readonly actor: APIInteractionGuildMember;
	readonly guild: APIGuild;
	readonly target: HierarchyMember | null;
	readonly targetId: Snowflake;
}

/**
 * Whether `actor` may act on `targetId`, by Discord's own hierarchy rules plus the two special cases every
 * moderation bot needs (self, and the guild owner).
 *
 * The bot's own position is checked separately by `checkBotHierarchy`, because the two failures want different
 * wording: one is "you can't do that", the other is "I can't do that".
 */
export function checkActorHierarchy({ actor, guild, target, targetId }: HierarchyCheckOptions): HierarchyVerdict {
	if (actor.user.id === targetId) {
		return { ok: false, reason: 'You cannot action yourself.' };
	}

	if (targetId === guild.owner_id) {
		return { ok: false, reason: 'You cannot action the server owner.' };
	}

	if (actor.user.id === guild.owner_id) {
		return OK;
	}

	if (!target) {
		return OK;
	}

	const actorPosition = highestPosition(actor.roles, guild);
	const targetPosition = highestPosition(target.roles, guild);

	if (targetPosition >= actorPosition) {
		return {
			ok: false,
			reason: 'You cannot action someone whose highest role is above or equal to yours.',
		};
	}

	return OK;
}

/**
 * What Discord's own command gating requires for each action, so a moderator reaching an action through a
 * button is held to the same bar as one typing the equivalent command.
 *
 * This exists because the report card is the one place in this bot where the action is chosen after the
 * interaction has already been authorized. `setDefaultMemberPermissions` gates a command by its name, which
 * works for `/ban` and cannot work for a "pick a punishment" select -- so without this, ModerateMembers on the
 * card would silently grant BanMembers. Legacy gated its report buttons on nothing at all.
 */
const REQUIRED_PERMISSION: Record<string, bigint> = {
	WARN: PermissionFlagsBits.ModerateMembers,
	MUTE: PermissionFlagsBits.ModerateMembers,
	UNMUTE: PermissionFlagsBits.ModerateMembers,
	KICK: PermissionFlagsBits.KickMembers,
	SOFTBAN: PermissionFlagsBits.BanMembers,
	BAN: PermissionFlagsBits.BanMembers,
	UNBAN: PermissionFlagsBits.BanMembers,
};

/**
 * Whether an interaction's member holds `permission`. `member.permissions` is the *computed* bitfield Discord
 * resolves for the invoking channel and hands to us in the payload, so this needs no role fetch and already
 * accounts for Administrator and channel overwrites.
 */
export function memberHasPermission(member: APIInteractionGuildMember, permission: bigint): boolean {
	return PermissionsBitField.any(BigInt(member.permissions), permission);
}

/**
 * Whether an interaction's member may take `action` on the card, by the same rule Discord would apply to the
 * equivalent slash command. Unknown actions are refused rather than allowed.
 */
export function memberMayTakeAction(member: APIInteractionGuildMember, action: string): boolean {
	const required = REQUIRED_PERMISSION[action];

	return required === undefined ? false : memberHasPermission(member, required);
}

export async function checkBotHierarchy(guild: APIGuild, target: HierarchyMember | null): Promise<HierarchyVerdict> {
	if (!target) {
		return OK;
	}

	const { api } = getContext().service.client;
	const selfMember = await api.guilds.getMember(guild.id, await getSelfId(api));

	if (highestPosition(target.roles, guild) >= highestPosition(selfMember.roles, guild)) {
		return { ok: false, reason: "That member's highest role is above mine, so I can't action them." };
	}

	return OK;
}
