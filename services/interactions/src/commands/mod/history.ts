import { makeHistoryEmbed } from '@automoderator/util';
import { REST } from '@discordjs/rest';
import { LogChannelType, PrismaClient } from '@prisma/client';
import {
	APIGuildInteraction,
	ApplicationCommandType,
	APIApplicationCommandInteractionData,
} from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import type { HistoryCommand } from '#interactions';
import { ArgumentsOf, send } from '#util';

@injectable()
export default class implements Command {
	public constructor(public readonly rest: REST, public readonly prisma: PrismaClient) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof HistoryCommand>) {
		const { user: member } = args;

		const cases = await this.prisma.case.findMany({
			where: { guildId: interaction.guild_id, targetId: member.user.id },
		});
		const filterTriggers = await this.prisma.filterTrigger.findFirst({
			where: { guildId: interaction.guild_id, userId: member.user.id },
		});
		const logWebhook = await this.prisma.logChannelWebhook.findFirst({
			where: { guildId: interaction.guild_id, logType: LogChannelType.mod },
		});

		const embed = makeHistoryEmbed({
			user: member.user,
			cases,
			logChannelId: logWebhook?.threadId ?? logWebhook?.channelId,
			filterTriggers: filterTriggers?.count,
		});

		return send(interaction, {
			embed,
			flags: (interaction.data as APIApplicationCommandInteractionData).type === ApplicationCommandType.User ? 64 : 0,
		});
	}
}
