import type { Logger } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from '@discordjs/core';
import { CASE_ACTION } from '../lib/caseActions.js';
import { runModCommand } from '../lib/modCommand.js';
import { REASON_MAX_LENGTH } from '../lib/modCommandOptions.js';

/**
 * Clears a timeout. Files its own case rather than mutating the mute's, so the history reads as a sequence of
 * things that happened — which is also what makes an early unmute visible at all.
 */
export default class UnmuteCommand implements CommandHandler {
	public readonly name = 'unmute';

	public readonly data = new ChatInputCommandBuilder()
		.setName('unmute')
		.setDescription("Lift a member's timeout early")
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addUserOptions((option) => option.setName('user').setDescription('The member to unmute').setRequired(true))
		.addStringOptions((option) =>
			option.setName('reason').setDescription('Why the mute is being lifted').setMaxLength(REASON_MAX_LENGTH),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		await runModCommand(interaction, logger, { action: CASE_ACTION.UNMUTE, notifyTarget: false });
	}
}
