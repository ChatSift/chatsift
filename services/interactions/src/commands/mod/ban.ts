import { CaseManager, PermissionsChecker, UserPerms } from '@automoderator/util';
import ms from '@naval-base/ms';
import { CaseAction, PrismaClient } from '@prisma/client';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import { handleLockConfirmation } from './sub/handleLockConfirmation';
import type { Command } from '../../command';
import { ArgumentsOf, ControlFlowError, send } from '../../util';
import type { BanCommand } from '#interactions';

@injectable()
export default class implements Command {
	public constructor(
		public readonly checker: PermissionsChecker,
		public readonly cases: CaseManager,
		public readonly prisma: PrismaClient,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof BanCommand>) {
		await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);
		const { user: member, reason, reference: refId, days, duration: durationString } = args;
		if (reason && reason.length >= 1900) {
			throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
		}

		if (member.user.id === interaction.member.user.id) {
			throw new ControlFlowError('You cannot ban yourself');
		}

		if (member.permissions && (await this.checker.check({ guild_id: interaction.guild_id, member }, UserPerms.mod))) {
			throw new ControlFlowError('You cannot action a member of the staff team');
		}

		let expiresAt: Date | undefined;
		if (durationString) {
			const durationMinutes = Number(durationString);

			if (isNaN(durationMinutes)) {
				const duration = ms(durationString);
				if (!duration) {
					throw new ControlFlowError('Failed to parse the provided duration');
				}

				expiresAt = new Date(Date.now() + duration);
			} else {
				expiresAt = new Date(Date.now() + durationMinutes * 6e4);
			}
		}

		const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
		const targetTag = `${member.user.username}#${member.user.discriminator}`;

		const locked = await this.cases.isLocked(CaseAction.ban, member.user.id, interaction.guild_id);
		if (locked && !(await handleLockConfirmation(interaction, member, locked))) {
			return;
		}

		await this.cases.create({
			actionType: CaseAction.ban,
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
			expiresAt,
		});

		await send(interaction, { content: `Successfully banned ${targetTag}`, components: [], embeds: [] });
	}
}
