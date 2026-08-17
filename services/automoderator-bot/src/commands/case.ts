import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import type { CaseActionName } from '@chatsift/core';
import type { AutomoderatorCases } from '@chatsift/db';
import { parseRelativeTimeSafe } from '@chatsift/parse-relative-time';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type {
	APIApplicationCommandInteraction,
	APIChatInputApplicationCommandInteraction,
	APIInteractionGuildMember,
} from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { executeAction } from '../lib/actionExecutor.js';
import { CASE_ACTION } from '../lib/caseActions.js';
import { buildCaseEmbed, formatDuration } from '../lib/caseFormat.js';
import { dispatchCaseLog, getModLogWebhook } from '../lib/caseLog.js';
import type { CaseActor } from '../lib/cases.js';
import { actorFromUser, deleteCase, getCaseByNumber, updateCase } from '../lib/cases.js';
import { REASON_MAX_LENGTH } from '../lib/modCommandOptions.js';
import { MAX_MUTE_MS, buildAuditReason } from '../lib/moderation.js';
import { memberMayTakeAction } from '../lib/permissions.js';

/**
 * Reading and amending existing cases.
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
					.setName('duration')
					.setDescription('Re-time a temporary ban or a mute')
					.addIntegerOptions((option) =>
						option.setName('case').setDescription('The case number').setRequired(true).setMinValue(1),
					)
					.addStringOptions((option) =>
						option
							.setName('duration')
							.setDescription('How long from when the case was filed, e.g. "2h", "7d"')
							.setRequired(true),
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

		try {
			await this.dispatch(interaction, interaction.guild_id, logger, reply);
		} catch (error) {
			logger.error({ err: error }, '/case failed');
			await reply('That failed, and the case may not have been changed. The error has been logged.');
		}
	}

	private async dispatch(
		interaction: APIApplicationCommandInteraction,
		guildId: string,
		logger: Logger,
		reply: (content: string) => Promise<void>,
	): Promise<void> {
		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const subcommand = options.getSubcommand(true);
		const caseNumber = options.getInteger('case', true);

		const modCase = await getCaseByNumber(guildId, caseNumber);
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

				const reference = await getCaseByNumber(guildId, refId);
				if (!reference) {
					await reply(`There is no case #${refId} in this server.`);
					return;
				}

				const updated = await updateCase(modCase.id, { refId, mod: moderator });
				await dispatchCaseLog(updated, logger);
				await reply(`Case #${caseNumber} now references #${refId}.`);
				break;
			}

			case 'duration': {
				// Gated by the *case's* action, not by `/case`'s own `ModerateMembers`. This is the one subcommand
				// with a Discord side effect, and re-timing a ban into the past makes the expiry sweep unban
				// somebody -- so without this, ModerateMembers would silently grant BanMembers. Exactly the hole
				// `memberMayTakeAction` was added to close on the report card, reused rather than restated.
				if (!memberMayTakeAction(interaction.member!, modCase.actionType as unknown as CaseActionName)) {
					await reply(`You do not have the permission Discord requires to change a ${modCase.actionType.toLowerCase()}.`);
					return;
				}

				await this.retime(modCase, options.getString('duration', true), moderator, logger, reply);
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

	/**
	 * Re-times a case, measured from when it was filed rather than from now: "make that a 7-day ban" means the
	 * ban lasts seven days, not seven more days on top of however long they have already served.
	 *
	 * A BAN needs no Discord call at all — `expires_at` *is* the schedule, so writing it is the whole edit, and a
	 * new expiry already in the past simply makes the case due on the sweep's next tick. A MUTE does, because
	 * Discord owns that expiry.
	 */
	private async retime(
		modCase: AutomoderatorCases,
		raw: string,
		moderator: CaseActor,
		logger: Logger,
		reply: (content: string) => Promise<void>,
	): Promise<void> {
		if (modCase.actionType !== CASE_ACTION.BAN && modCase.actionType !== CASE_ACTION.MUTE) {
			await reply('Only bans and mutes have a duration you can change.');
			return;
		}

		if (modCase.liftedAt) {
			await reply(`Case #${modCase.caseId} has already been lifted.`);
			return;
		}

		const parsed = parseRelativeTimeSafe(raw);
		if (!parsed.ok) {
			await reply(`Couldn't parse that duration: ${parsed.message}`);
			return;
		}

		if (parsed.value <= 0) {
			await reply('That duration is in the past.');
			return;
		}

		const expiresAt = new Date(modCase.createdAt.getTime() + parsed.value);
		const remainingMs = expiresAt.getTime() - Date.now();

		if (modCase.actionType === CASE_ACTION.MUTE) {
			if (remainingMs > MAX_MUTE_MS) {
				await reply('Discord timeouts cap out at 28 days from now, so a mute cannot run that long.');
				return;
			}

			const api = getContext().service.client.api;
			await executeAction(
				{
					action: 'mute',
					guildId: modCase.guildId,
					source: 'command',
					targetId: modCase.targetId,
					async execute() {
						await api.guilds.editMember(
							modCase.guildId,
							modCase.targetId,
							// A new expiry that has already passed is a request to end the timeout now, which is what
							// clearing it does. Handing Discord a past timestamp is rejected rather than treated as one.
							{ communication_disabled_until: remainingMs > 0 ? expiresAt.toISOString() : null },
							{ reason: buildAuditReason(moderator, `re-timed case #${modCase.caseId}`) },
						);
					},
				},
				logger,
			);
		}

		const updated = await updateCase(modCase.id, { expiresAt, mod: moderator });
		await dispatchCaseLog(updated, logger);

		if (remainingMs > 0) {
			await reply(`Case #${modCase.caseId} now expires in ${formatDuration(remainingMs)}.`);
			return;
		}

		// A mute was already lifted above -- clearing the timeout is what a past expiry means for one. A ban is
		// the sweep's to lift, so it really is still in force for another tick.
		await reply(
			modCase.actionType === CASE_ACTION.MUTE
				? `Case #${modCase.caseId} is now expired, and their timeout has been cleared.`
				: `Case #${modCase.caseId} is now expired, and will be lifted shortly.`,
		);
	}

	private async show(interaction: APIApplicationCommandInteraction, modCase: AutomoderatorCases): Promise<void> {
		const webhook = await getModLogWebhook(modCase.guildId);
		const reference = modCase.refId === null ? null : await getCaseByNumber(modCase.guildId, modCase.refId);

		await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
			embeds: [buildCaseEmbed(modCase, { reference, logChannelId: webhook?.channelId ?? null })],
		});
	}
}
