import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags } from '@discordjs/core';
import { replyWithHistory } from '../lib/historyLookup.js';

export default class MyHistoryCommand implements CommandHandler {
	public readonly name = 'myhistory';

	public readonly data = new ChatInputCommandBuilder()
		.setName('myhistory')
		.setDescription('Show your own moderation history in this server')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, _logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		if (!interaction.guild_id || !interaction.member) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await replyWithHistory(interaction, interaction.member.user, interaction.guild_id, { self: true });
	}
}
