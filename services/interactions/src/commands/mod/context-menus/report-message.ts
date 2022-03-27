import type { ReportMessageContextMenu } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../../command';
import { ReportFailure, ReportHandler } from '@automoderator/util';
import { PrismaClient } from '@prisma/client';
import { Handler } from '#handler';

@injectable()
export default class implements Command {
	public readonly name = 'report message';

	public constructor(
		public readonly prisma: PrismaClient,
		public readonly reports: ReportHandler,
		public readonly handler: Handler,
	) {}

	public async exec(interaction: APIGuildInteraction, { message }: ArgumentsOf<typeof ReportMessageContextMenu>) {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: interaction.guild_id } });

		if (!settings?.reportsChannel) {
			throw new ControlFlowError('This server does not have a reports channel set up.');
		}

		if (message.author.id === interaction.member.user.id) {
			throw new ControlFlowError('You cannot report your own message.');
		}

		try {
			await this.reports.reportMessage(
				{ ...message, guild_id: interaction.guild_id },
				interaction.member.user,
				settings.reportsChannel,
				'No reason provided',
			);
			return await send(interaction, {
				content: 'Successfully flagged the given message to the staff team',
				flags: 64,
			});
		} catch (error) {
			if (error instanceof ReportFailure) {
				throw new ControlFlowError(error.reason);
			}

			throw error;
		}
	}
}
