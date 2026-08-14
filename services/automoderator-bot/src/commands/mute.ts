import type { Logger } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { parseRelativeTimeSafe } from '@chatsift/parse-relative-time';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from '@discordjs/core';
import { CASE_ACTION } from '../lib/caseActions.js';
import { runModCommand } from '../lib/modCommand.js';
import { REASON_MAX_LENGTH } from '../lib/modCommandOptions.js';
import { MAX_MUTE_MS } from '../lib/moderation.js';

export default class MuteCommand implements CommandHandler {
	public readonly name = 'mute';

	public readonly data = new ChatInputCommandBuilder()
		.setName('mute')
		.setDescription('Time a member out for a given duration')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addUserOptions((option) => option.setName('user').setDescription('The member to mute').setRequired(true))
		.addStringOptions((option) =>
			option.setName('duration').setDescription('How long, e.g. "30m", "2h", "7d" (max 28 days)').setRequired(true),
		)
		.addStringOptions((option) =>
			option.setName('reason').setDescription('Why they are being muted').setMaxLength(REASON_MAX_LENGTH),
		)
		.addIntegerOptions((option) =>
			option.setName('reference').setDescription('An existing case number this relates to').setMinValue(1),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		await runModCommand(interaction, logger, {
			action: CASE_ACTION.MUTE,
			extra(options) {
				const parsed = parseRelativeTimeSafe(options.getString('duration', true));
				if (!parsed.ok) {
					return `Couldn't parse that duration: ${parsed.message}`;
				}

				if (parsed.value <= 0) {
					return 'That duration is in the past.';
				}

				if (parsed.value > MAX_MUTE_MS) {
					return 'Discord timeouts cap out at 28 days, so a mute cannot be longer than that.';
				}

				return { durationMs: parsed.value };
			},
		});
	}
}
