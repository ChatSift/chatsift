import type { Logger } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { parseRelativeTimeSafe } from '@chatsift/parse-relative-time';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from '@discordjs/core';
import { CASE_ACTION } from '../lib/caseActions.js';
import { runModCommand } from '../lib/modCommand.js';
import { MAX_DELETE_MESSAGE_DAYS, REASON_MAX_LENGTH, SECONDS_PER_DAY } from '../lib/modCommandOptions.js';

/**
 * `duration` has no ceiling, unlike `/mute`'s: nothing here is a Discord timeout, so the expiry is ours to
 * honour and `expiredBanSweep.ts` is what honours it.
 */
export default class BanCommand implements CommandHandler {
	public readonly name = 'ban';

	public readonly data = new ChatInputCommandBuilder()
		.setName('ban')
		.setDescription('Ban a user from the server')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
		.addUserOptions((option) => option.setName('user').setDescription('The user to ban').setRequired(true))
		.addStringOptions((option) =>
			option.setName('reason').setDescription('Why they are being banned').setMaxLength(REASON_MAX_LENGTH),
		)
		.addStringOptions((option) =>
			option.setName('duration').setDescription('How long, e.g. "7d", "3mo". Leave empty for a permanent ban'),
		)
		.addIntegerOptions((option) =>
			option
				.setName('days')
				.setDescription('Days of their recent messages to delete (0-7)')
				.setMinValue(0)
				.setMaxValue(MAX_DELETE_MESSAGE_DAYS),
		)
		.addIntegerOptions((option) =>
			option.setName('reference').setDescription('An existing case number this relates to').setMinValue(1),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		await runModCommand(interaction, logger, {
			action: CASE_ACTION.BAN,
			requiresMember: false,
			extra(options) {
				const deleteMessageSeconds = (options.getInteger('days') ?? 0) * SECONDS_PER_DAY;
				const raw = options.getString('duration');

				if (raw === null) {
					return { deleteMessageSeconds };
				}

				const parsed = parseRelativeTimeSafe(raw);
				if (!parsed.ok) {
					return `Couldn't parse that duration: ${parsed.message}`;
				}

				if (parsed.value <= 0) {
					return 'That duration is in the past.';
				}

				return { deleteMessageSeconds, durationMs: parsed.value };
			},
		});
	}
}
