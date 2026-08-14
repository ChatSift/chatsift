import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import type { AutomoderatorCases } from '@chatsift/db';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type {
	APIApplicationCommandInteraction,
	APIChatInputApplicationCommandInteraction,
	APIInteractionGuildMember,
} from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { CASE_ACTION } from '../lib/caseActions.js';
import { buildCaseEmbed } from '../lib/caseFormat.js';
import { dispatchCaseLog, getModLogWebhook } from '../lib/caseLog.js';
import { actorFromUser, deleteCase, getCaseByNumber, updateCase } from '../lib/cases.js';
import { REASON_MAX_LENGTH } from '../lib/modCommandOptions.js';

/**
 * Reading and amending existing cases.
 *
 * Legacy's `duration` subcommand is deliberately absent: the only P1 action carrying a duration is a MUTE,
 * whose expiry Discord owns, and re-timing one is `/unmute` then `/mute`. It lands at P2 alongside timed bans,
 * where a scheduler exists to make an edited expiry mean anything.
 *
 * Every mutating subcommand re-dispatches the log so the original embed is rewritten in place rather than
 * joined by a second one — which is the whole reason `automoderator_cases.log_message_id` is stored.
 */
export default class CaseCommand implements CommandHandler {
	public readonly name = 'case';

	public readonly data = new ChatInputCommandBuilder()
		.setName('case')
		.setDescription('Inspect or amend a moderation case')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addSubcommands(
			(subcommand) =>
				subcommand
					.setName('show')
					.setDescription('Show a case')
					.addIntegerOptions((option) =>
						option.setName('case').setDescription('The case number').setRequired(true).setMinValue(1),
					),
			(subcommand) =>
				subcommand
					.setName('reason')
					.setDescription("Rewrite a case's reason")
					.addIntegerOptions((option) =>
						option.setName('case').setDescription('The case number').setRequired(true).setMinValue(1),
					)
					.addStringOptions((option) =>
						option.setName('reason').setDescription('The new reason').setRequired(true).setMaxLength(REASON_MAX_LENGTH),
					),
			(subcommand) =>
				subcommand
					.setName('reference')
					.setDescription('Point a case at a related case')
					.addIntegerOptions((option) =>
						option.setName('case').setDescription('The case number').setRequired(true).setMinValue(1),
					)
					.addIntegerOptions((option) =>
						option.setName('reference').setDescription('The case it relates to').setRequired(true).setMinValue(1),
					),
			(subcommand) =>
				subcommand
					.setName('pardon')
					.setDescription('Pardon a warn, so it stops counting against the user')
					.addIntegerOptions((option) =>
						option.setName('case').setDescription('The case number').setRequired(true).setMinValue(1),
					),
			(subcommand) =>
				subcommand
					.setName('delete')
					.setDescription('Delete a case outright')
					.addIntegerOptions((option) =>
						option.setName('case').setDescription('The case number').setRequired(true).setMinValue(1),
					),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		const reply = async (content: string) => {
			await api.interactions.editReply(interaction.application_id, interaction.token, { content });
		};

		if (!interaction.guild_id || !interaction.member) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const subcommand = options.getSubcommand(true);
		const caseNumber = options.getInteger('case', true);

		const modCase = await getCaseByNumber(interaction.guild_id, caseNumber);
		if (!modCase) {
			await reply(`There is no case #${caseNumber} in this server.`);
			return;
		}

		const moderator = actorFromUser((interaction.member as APIInteractionGuildMember).user);

		switch (subcommand) {
			case 'show': {
				await this.show(interaction, modCase);
				break;
			}

			case 'reason': {
				const updated = await updateCase(modCase.id, { reason: options.getString('reason', true), mod: moderator });
				await dispatchCaseLog(updated, logger);
				await reply(`Updated the reason on case #${caseNumber}.`);
				break;
			}

			case 'reference': {
				const refId = options.getInteger('reference', true);

				if (refId === caseNumber) {
					await reply('A case cannot reference itself.');
					return;
				}

				const reference = await getCaseByNumber(interaction.guild_id, refId);
				if (!reference) {
					await reply(`There is no case #${refId} in this server.`);
					return;
				}

				const updated = await updateCase(modCase.id, { refId, mod: moderator });
				await dispatchCaseLog(updated, logger);
				await reply(`Case #${caseNumber} now references #${refId}.`);
				break;
			}

			case 'pardon': {
				if (modCase.actionType !== CASE_ACTION.WARN) {
					await reply('Only warns can be pardoned.');
					return;
				}

				if (modCase.pardonedBy) {
					await reply(`Case #${caseNumber} is already pardoned.`);
					return;
				}

				const updated = await updateCase(modCase.id, { pardonedBy: moderator.id });
				await dispatchCaseLog(updated, logger);
				await reply(`Pardoned case #${caseNumber}.`);
				break;
			}

			case 'delete': {
				await deleteCase(modCase.id);
				await reply(
					`Deleted case #${caseNumber}.${
						modCase.logMessageId ? ' Its log message is still in the mod log as a record.' : ''
					}`,
				);
				break;
			}

			default: {
				await reply('Unknown subcommand.');
				break;
			}
		}
	}

	private async show(interaction: APIApplicationCommandInteraction, modCase: AutomoderatorCases): Promise<void> {
		const webhook = await getModLogWebhook(modCase.guildId);
		const reference = modCase.refId === null ? null : await getCaseByNumber(modCase.guildId, modCase.refId);

		await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
			embeds: [buildCaseEmbed(modCase, { reference, logChannelId: webhook?.channelId ?? null })],
		});
	}
}
