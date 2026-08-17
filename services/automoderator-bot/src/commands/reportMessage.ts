import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { MessageContextCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIMessageApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags } from '@discordjs/core';
import { DEFAULT_REPORT_REASON, resolveTargetMessage, submitMessageReport } from '../lib/reportFlow.js';

/**
 * The display label doubles as the routing key -- see `historyContextMenu.ts`.
 */
const LABEL = 'Report Message';

/**
 * The one-click report. Deliberately carries **no** `setDefaultMemberPermissions`: reporting is what ordinary
 * members do, and gating it would leave the feature usable only by the people who don't need it.
 *
 * Ships alongside `Report Message with Reason` rather than replacing it, matching legacy's pair. The split
 * earns its place: the fast path is one click on something obviously against the rules, and forcing a reason
 * picker in front of it is how a report queue ends up empty.
 */
export default class ReportMessageContextMenuCommand implements CommandHandler {
	public readonly name = LABEL;

	public readonly data = new MessageContextCommandBuilder()
		.setName(LABEL)
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		if (!interaction.guild_id || !interaction.member) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'This can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Deferred because filing writes rows and then posts a card, which is comfortably more than the three
		// seconds an initial interaction response gets.
		await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });

		const content = await submitMessageReport(
			{
				guildId: interaction.guild_id,
				message: resolveTargetMessage(interaction as APIMessageApplicationCommandInteraction),
				reporter: interaction.member,
				reason: DEFAULT_REPORT_REASON,
			},
			logger,
		);

		await api.interactions.editReply(interaction.application_id, interaction.token, { content });
	}
}
