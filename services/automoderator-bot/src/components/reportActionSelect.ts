import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
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
import { ComponentType, MessageFlags, TextInputStyle } from '@discordjs/core';
import { ModalInteractionOptionResolver } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';
import { ACTION_PAST_TENSE } from '../lib/caseFormat.js';
import { actorFromUser } from '../lib/cases.js';
import { describeCommandFailure } from '../lib/modCommand.js';
import { REASON_MAX_LENGTH } from '../lib/modCommandOptions.js';
import { MAX_MUTE_MS, applyModerationAction } from '../lib/moderation.js';
import { checkActorHierarchy, checkBotHierarchy, memberMayTakeAction } from '../lib/permissions.js';
import type { ReportActionName } from '../lib/reportCard.js';
import { REPORT_COMPONENT, isReportAction } from '../lib/reportCard.js';
import { refreshCard, resolveCardInteraction } from '../lib/reportComponents.js';
import { REPORT_STATE, setReportState } from '../lib/reports.js';

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
				...(action === 'MUTE'
					? [
							{
								type: ComponentType.Label as const,
								label: 'Duration',
								description: 'e.g. "30m", "2h", "7d". Discord timeouts cap out at 28 days.',
								component: {
									type: ComponentType.TextInput as const,
									custom_id: DURATION_INPUT_ID,
									style: TextInputStyle.Short as const,
									required: true,
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
		if (action === 'MUTE') {
			const raw = readOptionalTextInput(options, DURATION_INPUT_ID);
			const parsed = raw === null ? null : parseRelativeTimeSafe(raw);

			if (!parsed?.ok) {
				await reply(parsed ? `Couldn't parse that duration: ${parsed.message}` : 'A mute needs a duration.');
				return;
			}

			if (parsed.value <= 0) {
				await reply('That duration is in the past.');
				return;
			}

			if (parsed.value > MAX_MUTE_MS) {
				await reply('Discord timeouts cap out at 28 days, so a mute cannot be longer than that.');
				return;
			}

			durationMs = parsed.value;
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

			const result = await applyModerationAction(
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

			// The report closes only once the punishment has landed -- an ACTIONED report pointing at a case that
			// was never filed would be a queue entry claiming work nobody did.
			const updated = await setReportState(report.id, {
				state: REPORT_STATE.ACTIONED,
				moderator: actorFromUser(member.user),
				caseId: result.case.caseId,
			});

			await refreshCard(updated, logger);

			const verb = ACTION_PAST_TENSE[action as AutomoderatorCaseAction];
			await reply(
				result.suppressed
					? `**Dry run** — would have ${verb} ${report.targetTag}. (case #${result.case.caseId})`
					: `Successfully ${verb} ${report.targetTag}. (case #${result.case.caseId})`,
			);
		} catch (error) {
			logger.error({ err: error, reportId: report.id, action }, 'failed to action a report');
			await reply(describeCommandFailure(error));
		}
	}
}

/**
 * `null` when they aren't in the guild. A 404 here is an ordinary answer -- reports outlive memberships -- so it
 * is not worth distinguishing from a real failure, which the subsequent Discord call would surface anyway.
 */
async function fetchMember(guildId: string, userId: string): Promise<APIGuildMember | null> {
	try {
		return await getContext().service.client.api.guilds.getMember(guildId, userId);
	} catch {
		return null;
	}
}
