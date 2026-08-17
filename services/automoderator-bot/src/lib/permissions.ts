import { getContext } from '@chatsift/backend-core';
import { getSelfId } from '@chatsift/bot-core';
import type { APIGuild, APIGuildMember, APIInteractionGuildMember, Snowflake } from '@discordjs/core';

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
