import { CaseManager, PermissionsChecker, UserPerms } from '@automoderator/util';
import { CaseAction, PrismaClient } from '@prisma/client';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { InteractionResponseType } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import type { ArgumentsOf } from '../../util';
import { ControlFlowError, send } from '../../util';
import { handleLockConfirmation } from './sub/handleLockConfirmation';
import type { SoftbanCommand } from '#interactions';

@injectable()
export default class implements Command {
	public constructor(
		public readonly checker: PermissionsChecker,
		public readonly cases: CaseManager,
		public readonly prisma: PrismaClient,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof SoftbanCommand>) {
		await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);
		const { user: member, reason, reference: refId, days = 1 } = args;
		if (reason && reason.length >= 1_900) {
			throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
		}

		if (member.user.id === interaction.member.user.id) {
			throw new ControlFlowError('You cannot softban yourself');
		}

		if (member.permissions && (await this.checker.check({ guild_id: interaction.guild_id, member }, UserPerms.mod))) {
			throw new ControlFlowError('You cannot action a member of the staff team');
		}

		const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
		const targetTag = `${member.user.username}#${member.user.discriminator}`;

		const locked = await this.cases.isLocked(CaseAction.softban, member.user.id, interaction.guild_id);
		if (locked && !(await handleLockConfirmation(interaction, member, locked))) {
			return;
		}

		await this.cases.create({
			actionType: CaseAction.softban,
			guildId: interaction.guild_id,
			mod: {
				id: interaction.member.user.id,
				tag: modTag,
			},
			targetId: member.user.id,
			targetTag,
			reason,
			refId,
			deleteDays: days,
		});

		await send(interaction, { content: `Successfully softbanned ${targetTag}`, components: [], embeds: [] });
	}
}
