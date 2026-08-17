import type { Logger } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from '@discordjs/core';
import { CASE_ACTION } from '../lib/caseActions.js';
import { runModCommand } from '../lib/modCommand.js';
import { MAX_DELETE_MESSAGE_DAYS, REASON_MAX_LENGTH, SECONDS_PER_DAY } from '../lib/modCommandOptions.js';

export default class SoftbanCommand implements CommandHandler {
	public readonly name = 'softban';

	public readonly data = new ChatInputCommandBuilder()
		.setName('softban')
		.setDescription('Kick a member and delete their recent messages')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
		.addUserOptions((option) => option.setName('user').setDescription('The member to softban').setRequired(true))
		.addStringOptions((option) =>
			option.setName('reason').setDescription('Why they are being softbanned').setMaxLength(REASON_MAX_LENGTH),
		)
		.addIntegerOptions((option) =>
			option
				.setName('days')
				.setDescription('Days of their recent messages to delete (0-7, defaults to 1)')
				.setMinValue(0)
				.setMaxValue(MAX_DELETE_MESSAGE_DAYS),
		)
		.addIntegerOptions((option) =>
			option.setName('reference').setDescription('An existing case number this relates to').setMinValue(1),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		await runModCommand(interaction, logger, {
			action: CASE_ACTION.SOFTBAN,
			extra(options) {
				return { deleteMessageSeconds: (options.getInteger('days') ?? 1) * SECONDS_PER_DAY };
			},
		});
	}
}
