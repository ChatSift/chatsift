import type { Logger } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from '@discordjs/core';
import { CASE_ACTION } from '../lib/caseActions.js';
import { runModCommand } from '../lib/modCommand.js';
import { REASON_MAX_LENGTH } from '../lib/modCommandOptions.js';

/**
 * The only mod command with no Discord side effect at all -- a warn is a case row and a DM. That makes it the
 * one place the hierarchy guard in `permissions.ts` is doing work nothing else would do: every other action is
 * also refused by Discord, this one isn't.
 */
export default class WarnCommand implements CommandHandler {
	public readonly name = 'warn';

	public readonly data = new ChatInputCommandBuilder()
		.setName('warn')
		.setDescription('Warn a member, filing a case against them')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addUserOptions((option) => option.setName('user').setDescription('The member to warn').setRequired(true))
		.addStringOptions((option) =>
			option.setName('reason').setDescription('Why they are being warned').setMaxLength(REASON_MAX_LENGTH),
		)
		.addIntegerOptions((option) =>
			option.setName('reference').setDescription('An existing case number this relates to').setMinValue(1),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		await runModCommand(interaction, logger, { action: CASE_ACTION.WARN });
	}
}
