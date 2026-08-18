import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { MessageContextCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIMessageApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags } from '@discordjs/core';
import { addToReportDraft } from '../lib/reportDraftFlow.js';
import { resolveTargetMessage } from '../lib/reportFlow.js';

const LABEL = 'Add to Report Draft';

export default class AddToReportDraftContextMenuCommand implements CommandHandler {
	public readonly name = LABEL;

	public readonly data = new MessageContextCommandBuilder()
		.setName(LABEL)
		.setContexts(InteractionContextType.PrivateChannel, InteractionContextType.BotDM)
		.setIntegrationTypes(ApplicationIntegrationType.UserInstall)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		// `user` rather than `member.user`: this only ever runs outside a guild, so there is no member object.
		const reporter = interaction.user;
		if (!reporter) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'This can only be used in a direct message.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Deferred because the draft round-trips redis, which is comfortably inside three seconds but not
		// worth betting an interaction on when the alternative costs nothing.
		await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });

		const content = await addToReportDraft(
			{ message: resolveTargetMessage(interaction as APIMessageApplicationCommandInteraction), reporter },
			logger,
		);

		await api.interactions.editReply(interaction.application_id, interaction.token, { content });
	}
}
