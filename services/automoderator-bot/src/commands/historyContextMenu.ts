import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { UserContextCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIUserApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { replyWithHistory } from '../lib/historyLookup.js';

/**
 * The display label doubles as the routing key -- `bot-core`'s command registry matches on
 * `interaction.data.name`, which for a context menu is what the user sees in the menu. Same arrangement as
 * ModMail's `Reply`.
 */
const LABEL = 'History';

export default class HistoryContextMenuCommand implements CommandHandler {
	public readonly name = LABEL;

	public readonly data = new UserContextCommandBuilder()
		.setName(LABEL)
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, _logger: Logger): Promise<void> {
		if (!interaction.guild_id) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const menu = interaction as APIUserApplicationCommandInteraction;
		const target = menu.data.resolved.users[menu.data.target_id]!;

		await replyWithHistory(interaction, target, interaction.guild_id);
	}
}
