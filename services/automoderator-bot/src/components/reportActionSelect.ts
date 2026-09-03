import type { Logger } from '@chatsift/backend-core';
import { getContext, getReport, REPORT_STATE, recordReportCase, setReportState } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { collectModal, readOptionalTextInput } from '@chatsift/bot-core';
import type { AutomoderatorCaseAction, AutomoderatorReports } from '@chatsift/db';
import { parseRelativeTimeSafe } from '@chatsift/parse-relative-time';
import type {
	APIGuildMember,
	APIInteractionGuildMember,
	APIMessageComponentInteraction,
	APIModalInteractionResponseCallbackData,
	APIModalSubmitInteraction,
} from '@discordjs/core';
import { ComponentType, MessageFlags, RESTJSONErrorCodes, TextInputStyle } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { ModalInteractionOptionResolver } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';
import { actorFromUser } from '../lib/cases.js';
import { reportsTotal } from '../lib/metrics.js';
import { describeCommandFailure, describeModerationResult } from '../lib/modCommand.js';
import { REASON_MAX_LENGTH } from '../lib/modCommandOptions.js';
import type { LadderFailureError } from '../lib/moderation.js';
import { MAX_MUTE_MS, applyModerationAction } from '../lib/moderation.js';
import { checkActorHierarchy, checkBotHierarchy, memberMayTakeAction } from '../lib/permissions.js';
import type { ReportActionName } from '../lib/reportCard.js';
import { REPORT_COMPONENT, isReportAction } from '../lib/reportCard.js';
import { refreshCard, resolveCardInteraction } from '../lib/reportComponents.js';
import { shouldReopenReport } from '../lib/reportFlow.js';

const REASON_INPUT_ID = 'reason';
const DURATION_INPUT_ID = 'duration';

const MODAL_TIMEOUT_MS = 5 * 60 * 1_000;

const REQUIRES_MEMBER: Record<ReportActionName, boolean> = {
	WARN: true,
	MUTE: true,
	KICK: true,
	BAN: false,
};

export default class ReportActionSelectComponent implements ComponentHandler<string> {
	public readonly name = REPORT_COMPONENT.actionSelect;

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, reportId: string, logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		const resolved = await resolveCardInteraction(interaction, reportId, logger);
		if (!resolved) {
			return;
		}

		const { report, member } = resolved;

		if (interaction.data.component_type !== ComponentType.StringSelect) {
			logger.warn({ customId: interaction.data.custom_id }, 'report action select fired for a non-select component');
			return;
		}

		const choice = interaction.data.values[0];
		if (!choice || !isReportAction(choice)) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'That is not an action I can take.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (report.state === REPORT_STATE.ACTIONED) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'Someone has already actioned this report.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!memberMayTakeAction(member, choice)) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: `You do not have the permission Discord requires for a ${choice.toLowerCase()}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const modalId = nanoid();
		await api.interactions.createModal(interaction.id, interaction.token, this.buildModal(modalId, choice, report));

		let modal: APIModalSubmitInteraction;
		try {
			modal = await collectModal(modalId, MODAL_TIMEOUT_MS);
		} catch {
			// Routine -- see the same guard in `reportMessageWithReason.ts`. No follow-up here: the moderator
			// abandoning a punishment modal needs no confirmation that nothing happened.
			return;
		}

		await this.applyAction({ modal, report, member, action: choice, logger });
	}

	private buildModal(
		modalId: string,
		action: ReportActionName,
		report: AutomoderatorReports,
	): APIModalInteractionResponseCallbackData {
		return {
			custom_id: modalId,
			title: `${action[0]}${action.slice(1).toLowerCase()} ${report.targetTag}`.slice(0, 45),
			components: [
				...(action === 'MUTE' || action === 'BAN'
					? [
							{
								type: ComponentType.Label as const,
								label: 'Duration',
								description:
									action === 'MUTE'
										? 'e.g. "30m", "2h", "7d". Discord timeouts cap out at 28 days.'
										: 'e.g. "7d", "3mo". Leave empty for a permanent ban.',
								component: {
									type: ComponentType.TextInput as const,
									custom_id: DURATION_INPUT_ID,
									style: TextInputStyle.Short as const,
									// A mute has no open-ended form; a ban does, and empty is how you ask for it.
									required: action === 'MUTE',
									max_length: 32,
								},
							},
						]
					: []),
				{
					type: ComponentType.Label as const,
					label: 'Reason',
					description: 'Shown to the target and recorded on the case.',
					component: {
						type: ComponentType.TextInput as const,
						custom_id: REASON_INPUT_ID,
						style: TextInputStyle.Paragraph as const,
						required: false,
						max_length: REASON_MAX_LENGTH,
					},
				},
			],
		};
	}

	private async applyAction({
		action,
		logger,
		member,
		modal,
		report,
	}: {
		action: ReportActionName;
		logger: Logger;
		member: APIInteractionGuildMember;
		modal: APIModalSubmitInteraction;
		report: AutomoderatorReports;
	}): Promise<void> {
		const api = getContext().service.client.api;
		await api.interactions.defer(modal.id, modal.token, { flags: MessageFlags.Ephemeral });

		const reply = async (content: string) => {
			await api.interactions.editReply(modal.application_id, modal.token, { content });
		};

		const options = new ModalInteractionOptionResolver(modal);
		const reason = readOptionalTextInput(options, REASON_INPUT_ID);

		let durationMs: number | undefined;
		if (action === 'MUTE' || action === 'BAN') {
			// Empty is a permanent ban, and is the only way to ask for one here. A mute has no such reading, so an
			// empty box there is a mistake rather than a choice.
			const raw = readOptionalTextInput(options, DURATION_INPUT_ID);
			const parsed = raw === null ? null : parseRelativeTimeSafe(raw);

			if (parsed === null && action === 'MUTE') {
				await reply('A mute needs a duration.');
				return;
			}

			if (parsed !== null) {
				if (!parsed.ok) {
					await reply(`Couldn't parse that duration: ${parsed.message}`);
					return;
				}

				if (parsed.value <= 0) {
					await reply('That duration is in the past.');
					return;
				}

				if (action === 'MUTE' && parsed.value > MAX_MUTE_MS) {
					await reply('Discord timeouts cap out at 28 days, so a mute cannot be longer than that.');
					return;
				}

				durationMs = parsed.value;
			}
		}

		try {
			const guild = await api.guilds.get(report.guildId);
			const targetMember = await fetchMember(report.guildId, report.targetId);

			if (REQUIRES_MEMBER[action] && !targetMember) {
				await reply('That user is no longer in this server.');
				return;
			}

			const actorVerdict = checkActorHierarchy({
				actor: member,
				guild,
				target: targetMember,
				targetId: report.targetId,
			});

			if (!actorVerdict.ok) {
				await reply(actorVerdict.reason);
				return;
			}

			const botVerdict = await checkBotHierarchy(guild, targetMember);
			if (!botVerdict.ok) {
				await reply(botVerdict.reason);
				return;
			}

			// **Claimed before anybody is punished, not after.** The state read in `handle` is up to
			// `MODAL_TIMEOUT_MS` old by now, so a second moderator could have actioned this report while this modal
			// sat open. Writing the state afterwards would only decide whose `case_id` survives -- both targets
			// would already have been banned. A compare-and-swap here is the mutex, and it is cheap because
			// `applyModerationAction` is the expensive, irreversible half that follows it.
			const claimed = await setReportState(report.id, {
				state: REPORT_STATE.ACTIONED,
				expected: report.state,
				moderator: actorFromUser(member.user),
			});

			if (!claimed) {
				await reply('Someone else handled this report while that was open, so nothing was done.');
				// Their card is stale by definition if they lost the race -- rewrite it from the row they lost to.
				const current = await getReport(report.id);
				if (current) {
					await refreshCard(current, logger);
				}

				return;
			}

			let result;
			try {
				result = await applyModerationAction(
					{
						action: action as AutomoderatorCaseAction,
						guildId: report.guildId,
						target: { id: report.targetId, tag: report.targetTag },
						mod: actorFromUser(member.user),
						source: 'report',
						reason,
						...(durationMs === undefined ? {} : { durationMs }),
					},
					logger,
				);
			} catch (error) {
				// A ladder rung failing does **not** undo the warn -- it is already filed and its log is out. The
				// report stays terminal and points at the warn that landed; see `shouldReopenReport`.
				if (!shouldReopenReport(error)) {
					reportsTotal.inc({ state: 'actioned' });
					const recorded = await recordReportCase(report.id, (error as LadderFailureError).warnCase.caseId);
					await refreshCard(recorded ?? claimed, logger);
					await reply(describeCommandFailure(error));
					return;
				}

				// Every other failure really did leave the target un-punished, so the claim has to come back off:
				// otherwise a report is permanently closed with nothing to show for it and no way to retry.
				await setReportState(report.id, {
					state: report.state,
					expected: REPORT_STATE.ACTIONED,
					moderator: null,
				});

				throw error;
			}

			// Counted here rather than inside `setReportState`, so the metric only ever reflects reports that
			// really did produce a punishment.
			reportsTotal.inc({ state: 'actioned' });

			const recorded = await recordReportCase(report.id, result.case.caseId);
			await refreshCard(recorded ?? claimed, logger);

			await reply(describeModerationResult(result, report.targetTag, action as AutomoderatorCaseAction));
		} catch (error) {
			logger.error({ err: error, reportId: report.id, action }, 'failed to action a report');
			await reply(describeCommandFailure(error));
		}
	}
}

/**
 * `null` when they genuinely aren't in the guild — and **only** then. Reports outlive memberships, so a 404 is an
 * ordinary answer here.
 *
 * Everything else rethrows, which matters more than it looks: `checkActorHierarchy` returns OK for a `null`
 * target (there are no roles to compare), and a BAN doesn't require membership. So swallowing a 500 or a timeout
 * from this call would silently *skip* the role-hierarchy comparison rather than fail it, letting a moderator ban
 * someone ranked above them. `modCommand.ts` never has this window because a USER option carries the resolved
 * member in the interaction payload, with no network call to fail.
 */
async function fetchMember(guildId: string, userId: string): Promise<APIGuildMember | null> {
	try {
		return await getContext().service.client.api.guilds.getMember(guildId, userId);
	} catch (error) {
		if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMember) {
			return null;
		}

		throw error;
	}
}
