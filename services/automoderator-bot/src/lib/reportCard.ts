import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorReports, AutomoderatorReportState } from '@chatsift/db';
import type { APIActionRowComponent, APIEmbed, APIMessage, APIMessageTopLevelComponent } from '@discordjs/core';
import { ButtonStyle, ComponentType, RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { executeAction } from './actionExecutor.js';
import { reportDetailLink } from './dashboardLinks.js';
import { REPORT_STATE, getReportsChannelId, setReportCard } from './reports.js';

/**
 * Custom-id prefixes for the card's buttons. Each is a separate registered `ComponentHandler`, rather than one
 * handler switching on a suffix: `bot-core`'s registry splits a custom id into `name:state` and routes on the
 * name, so a suffix would be a second parser living outside the registry's contract.
 */
export const REPORT_COMPONENT = {
	dismiss: 'report-dismiss',
	reporters: 'report-reporters',
	action: 'report-action',
	actionSelect: 'report-action-select',
} as const;

/**
 * What the Action button offers. Legacy's set minus its `noop` option, which set the same
 * acknowledged-and-no-punishment state the Dismiss button already produces -- two routes to one outcome is
 * worth not porting.
 *
 * No SOFTBAN and no timed ban: a softban's whole purpose is bulk message deletion, which a report about one
 * message doesn't call for, and a ban duration needs the scheduler P2 adds. `/ban` is under the same
 * restriction for the same reason.
 */
export const REPORT_ACTION_OPTIONS = [
	{ action: 'WARN', label: 'Warn', description: 'Record a warning and DM them' },
	{ action: 'MUTE', label: 'Mute', description: 'Time them out for a duration you pick' },
	{ action: 'KICK', label: 'Kick', description: 'Remove them from the server' },
	{ action: 'BAN', label: 'Ban', description: 'Ban them permanently' },
] as const;

export type ReportActionName = (typeof REPORT_ACTION_OPTIONS)[number]['action'];

export function isReportAction(value: string): value is ReportActionName {
	return REPORT_ACTION_OPTIONS.some((option) => option.action === value);
}

/**
 * Reads back as red while it needs attention, muted once it doesn't. Deliberately *not* drawn from
 * `LOG_COLORS`: those are keyed by case action and mean "how severe was the punishment", which is a different
 * axis from "does this still need a moderator".
 */
const STATE_COLORS: Record<AutomoderatorReportState, number> = {
	OPEN: 0xed_45_45,
	DISMISSED: 0x4f_54_5c,
	ACTIONED: 0x57_f2_87,
} as Record<AutomoderatorReportState, number>;

const STATE_LABELS: Record<AutomoderatorReportState, string> = {
	OPEN: 'Open',
	DISMISSED: 'Dismissed',
	ACTIONED: 'Actioned',
} as Record<AutomoderatorReportState, string>;

/**
 * Discord's embed description cap is 4096, and a reported message can be 4000 characters of its own before the
 * surrounding text. Truncated rather than dropped: a moderator reading the first 1500 characters of a wall of
 * text has what they need to act.
 */
const CONTENT_LIMIT = 1_500;

function truncate(value: string, limit: number): string {
	return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/**
 * Whether staff can actually follow a link to the reported message. Keyed on `origin` rather than on the
 * channel id being present: a DM-origin report (the phase after this one) has a channel id nobody but the two
 * participants can open, so rendering a link for it would be a button that always fails.
 */
function isLinkable(report: AutomoderatorReports): boolean {
	return report.origin === 'GUILD' && Boolean(report.messageId) && Boolean(report.channelId);
}

function describeSubject(report: AutomoderatorReports): string {
	if (!report.messageId) {
		return 'Was reported.';
	}

	const where = isLinkable(report) ? ` in <#${report.channelId}>` : '';
	const content = report.messageContent?.trim().length
		? `\`\`\`\n${truncate(report.messageContent, CONTENT_LIMIT)}\n\`\`\``
		: '*The message had no text content.*';

	return `Had a message${where} reported.\n\n${content}`;
}

export interface ReportCardOptions {
	/**
	 * Link to this report on the dashboard. Passed in rather than derived here so this stays a pure function of
	 * the row -- `getContext()` in an embed builder is what makes it untestable without a live context.
	 */
	readonly dashboardLink?: string;
	readonly reporterCount: number;
}

export function buildReportEmbed(
	report: AutomoderatorReports,
	{ dashboardLink, reporterCount }: ReportCardOptions,
): APIEmbed {
	const plural = reporterCount === 1 ? 'reporter' : 'reporters';

	// In the description, not the footer: Discord renders no markdown at all in an embed footer, so a link there
	// is unclickable text. Same finding as `/history`'s link at P1.
	const description = dashboardLink
		? `${describeSubject(report)}\n\n[Open this report on the dashboard](${dashboardLink})`
		: describeSubject(report);

	return {
		color: STATE_COLORS[report.state],
		author: { name: `${report.targetTag} (${report.targetId})` },
		description,
		footer: {
			text: `Report ${report.id} | ${reporterCount} ${plural} | ${STATE_LABELS[report.state]}`,
		},
		timestamp: report.createdAt.toISOString(),
		// The CDN url is handed to Discord, which re-hosts the image against this message -- which is what keeps
		// the card readable after the original (signed, expiring) url stops resolving.
		...(report.messageImageUrl ? { image: { url: report.messageImageUrl } } : {}),
	};
}

export function buildReportComponents(report: AutomoderatorReports): APIMessageTopLevelComponent[] {
	const dismissed = report.state === REPORT_STATE.DISMISSED;
	// Actioning is terminal: the report produced a case, and that case is the record now. Leaving the buttons
	// live would offer a second punishment for the same report with nothing to stop it.
	const closed = report.state === REPORT_STATE.ACTIONED;

	const row: APIActionRowComponent<any> = {
		type: ComponentType.ActionRow,
		components: [
			// A link button rather than a handled one, so "go look at it" costs no interaction -- and it is
			// omitted entirely for an account-level report, where there is nothing to jump to. Legacy shipped a
			// permanently disabled placeholder button there instead.
			...(isLinkable(report)
				? [
						{
							type: ComponentType.Button as const,
							style: ButtonStyle.Link as const,
							label: 'Review',
							url: `https://discord.com/channels/${report.guildId}/${report.channelId}/${report.messageId}`,
						},
					]
				: []),
			{
				type: ComponentType.Button as const,
				style: dismissed ? ButtonStyle.Danger : ButtonStyle.Success,
				label: dismissed ? 'Restore' : 'Dismiss',
				custom_id: `${REPORT_COMPONENT.dismiss}:${report.id}`,
				disabled: closed,
			},
			{
				type: ComponentType.Button as const,
				style: ButtonStyle.Primary as const,
				label: 'View reporters',
				custom_id: `${REPORT_COMPONENT.reporters}:${report.id}`,
			},
			{
				type: ComponentType.Button as const,
				style: ButtonStyle.Danger as const,
				label: 'Action',
				custom_id: `${REPORT_COMPONENT.action}:${report.id}`,
				disabled: closed,
			},
		],
	};

	return [row];
}

/**
 * Posts the card, or rewrites the one already posted.
 *
 * Every state the card can show is derived from the row here, rather than by mutating the components off the
 * interaction's own message. Legacy did the latter and read the *button label* to decide whether it was
 * dismissing or restoring -- deriving state from the UI it just rendered, which goes wrong the moment two
 * moderators click at once.
 */
export async function syncReportCard(
	report: AutomoderatorReports,
	options: ReportCardOptions,
	logger: Logger,
): Promise<void> {
	const api = getContext().service.client.api;
	const body = {
		embeds: [buildReportEmbed(report, { ...options, dashboardLink: reportDetailLink(report.guildId, report.id) })],
		components: buildReportComponents(report),
	};

	// A card already posted is edited where it is, even if the guild has since pointed reports at a different
	// channel -- editing it in the new channel is not a thing Discord can do.
	const channelId = report.cardMessageId ? report.cardChannelId : await getReportsChannelId(report.guildId);
	if (!channelId) {
		return;
	}

	try {
		let posted: APIMessage | undefined;

		await executeAction(
			{
				action: 'message',
				guildId: report.guildId,
				source: 'report',
				targetId: report.targetId,
				async execute() {
					if (report.cardMessageId) {
						await api.channels.editMessage(channelId, report.cardMessageId, body);
					} else {
						posted = await api.channels.createMessage(channelId, body);
					}
				},
			},
			logger,
		);

		if (posted) {
			await setReportCard(report.id, { channelId, messageId: posted.id });
		}
	} catch (error) {
		if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage) {
			// Someone deleted the card. Forget it so the next transition posts a fresh one, rather than editing a
			// message that no longer exists forever -- the same self-heal `dispatchCaseLog` does for its webhook.
			await setReportCard(report.id, null);
			logger.warn({ guildId: report.guildId, reportId: report.id }, 'report card was deleted, forgot it');
			return;
		}

		// Swallowed rather than rethrown, unlike a moderation action: the report row is already committed and the
		// dashboard queue shows it, so a card that failed to post is a degraded surface rather than lost work.
		// The reporter has already been told their report went through, and it did.
		logger.error({ err: error, guildId: report.guildId, reportId: report.id }, 'failed to sync a report card');
	}
}
