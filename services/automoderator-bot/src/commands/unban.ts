import type { Logger } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from '@discordjs/core';
import { CASE_ACTION } from '../lib/caseActions.js';
import { runModCommand } from '../lib/modCommand.js';
import { REASON_MAX_LENGTH } from '../lib/modCommandOptions.js';

export default class UnbanCommand implements CommandHandler {
	public readonly name = 'unban';

	public readonly data = new ChatInputCommandBuilder()
		.setName('unban')
		.setDescription('Lift a ban')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
		.addUserOptions((option) => option.setName('user').setDescription('The user to unban').setRequired(true))
		.addStringOptions((option) =>
			option.setName('reason').setDescription('Why the ban is being lifted').setMaxLength(REASON_MAX_LENGTH),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		await runModCommand(interaction, logger, {
			action: CASE_ACTION.UNBAN,
			requiresMember: false,
			notifyTarget: false,
		});
	}
}
