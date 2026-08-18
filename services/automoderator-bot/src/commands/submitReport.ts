import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags } from '@discordjs/core';
import { submitReportDraft } from '../lib/reportDraftFlow.js';

export default class SubmitReportCommand implements CommandHandler {
	public readonly name = 'submit-report';

	public readonly data = new ChatInputCommandBuilder()
		.setName('submit-report')
		.setDescription('Finish a report you started with the Add to Report Draft menu')
		.setContexts(InteractionContextType.PrivateChannel, InteractionContextType.BotDM)
		.setIntegrationTypes(ApplicationIntegrationType.UserInstall)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		const reporter = interaction.user;
		if (!reporter) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a direct message.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });

		const content = await submitReportDraft(reporter, logger);

		await api.interactions.editReply(interaction.application_id, interaction.token, { content });
	}
}
