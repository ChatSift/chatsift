import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags } from '@discordjs/core';
import type { CommandHandler } from './commands.js';
import { getAllCommandsData } from './commands.js';

/**
 * Shared by every bot — admin-gated (`env.ADMINS`), bulk-overwrites the **global** command set
 * (`bulkOverwriteGlobalCommands`) from every command handler currently registered for the process, including
 * itself (omitting it would delete `/deploy` on its own next run). `createBotClient` registers this
 * automatically, so services never need to discover or wire it up themselves.
 */
export default class DeployCommand implements CommandHandler {
	public readonly name = 'deploy';

	public readonly data = new ChatInputCommandBuilder()
		.setName('deploy')
		.setDescription('Bulk-overwrite all global commands with every registered command handler')
		.setContexts(InteractionContextType.BotDM)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger) {
		const userId = interaction.user?.id;
		if (!userId || !getContext().env.ADMINS.has(userId)) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'You are not authorized to run this command.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await getContext().service.client.api.interactions.defer(interaction.id, interaction.token, {
			flags: MessageFlags.Ephemeral,
		});

		try {
			const commandsData = getAllCommandsData();
			await getContext().service.client.api.applicationCommands.bulkOverwriteGlobalCommands(
				interaction.application_id,
				commandsData,
			);

			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: `Deployed ${commandsData.length} global command(s).`,
			});
		} catch (error) {
			logger.error({ err: error }, 'Failed to deploy global commands');

			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: 'Failed to deploy commands. Check the logs.',
			});
		}
	}
}
