import type { Logger } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from '@discordjs/core';
import { CASE_ACTION } from '../lib/caseActions.js';
import { runModCommand } from '../lib/modCommand.js';
import { REASON_MAX_LENGTH } from '../lib/modCommandOptions.js';

export default class KickCommand implements CommandHandler {
	public readonly name = 'kick';

	public readonly data = new ChatInputCommandBuilder()
		.setName('kick')
		.setDescription('Remove a member from the server')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
		.addUserOptions((option) => option.setName('user').setDescription('The member to kick').setRequired(true))
		.addStringOptions((option) =>
			option.setName('reason').setDescription('Why they are being kicked').setMaxLength(REASON_MAX_LENGTH),
		)
		.addIntegerOptions((option) =>
			option.setName('reference').setDescription('An existing case number this relates to').setMinValue(1),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		await runModCommand(interaction, logger, { action: CASE_ACTION.KICK });
	}
}
