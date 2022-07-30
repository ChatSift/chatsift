import { CaseManager, PermissionsChecker } from '@automoderator/util';
import { Rest } from '@cordis/rest';
import { CaseAction, PrismaClient } from '@prisma/client';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import type { UnbanCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';

@injectable()
export default class implements Command {
	public constructor(
		public readonly rest: Rest,
		public readonly checker: PermissionsChecker,
		public readonly cases: CaseManager,
		public readonly prisma: PrismaClient,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof UnbanCommand>) {
		await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);
		const { user: member, reason = 'no reason provided' } = args;
		if (reason && reason.length >= 1900) {
			throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
		}

		const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
		const targetTag = `${member.user.username}#${member.user.discriminator}`;

		const cs = await this.prisma.case.findFirst({
			where: {
				guildId: interaction.guild_id,
				targetId: member.user.id,
				actionType: CaseAction.ban,
				task: { isNot: null },
			},
		});

		if (cs) {
			await this.cases.undoTimedAction(cs, reason);
		} else {
			await this.cases.create({
				actionType: CaseAction.unban,
				guildId: interaction.guild_id,
				mod: {
					id: interaction.member.user.id,
					tag: modTag,
				},
				targetId: member.user.id,
				targetTag,
				reason,
			});
		}

		await send(interaction, { content: `Successfully unbanned ${targetTag}` });
	}
}
