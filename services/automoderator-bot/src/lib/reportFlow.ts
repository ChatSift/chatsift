import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { REPORT_PRESET_MAX_COUNT } from '@chatsift/core';
import type {
	APIMessage,
	APIMessageApplicationCommandInteraction,
	APIInteractionGuildMember,
} from '@discordjs/core';
import { actorFromUser } from './cases.js';
import { syncReportCard } from './reportCard.js';
import type { ReportedMessage } from './reports.js';
import { REFUSAL_MESSAGES, ReportFailure, fileReport, getReportsChannelId } from './reports.js';

export const DEFAULT_REPORT_REASON = 'No reason provided';

/**
 * The reported message's first image, for the card's embed.
 *
 * Checks the embeds as well as the attachments because of a platform behaviour this codebase has already been
 * bitten by: a message whose single image Discord has claimed into an embed comes back with an **empty**
 * top-level `attachments` array. Reading only `attachments[0]` would silently drop the image from exactly the
 * kind of message people report.
 */
export function firstImageUrl(message: Pick<APIMessage, 'attachments' | 'embeds'>): string | null {
	// `?? false`, not `?? true`: an attachment Discord didn't type is not assumed to be an image. Guessing wrong
	// puts a video or a pdf url into the embed's `image`, which Discord then fails to render -- and the embed
	// fallback below is a better answer for that message anyway.
	const attachment = message.attachments.find((candidate) => candidate.content_type?.startsWith('image/') ?? false);
	if (attachment) {
		return attachment.url;
	}

	for (const embed of message.embeds) {
		const url = embed.image?.url ?? embed.thumbnail?.url;
		if (url) {
			return url;
		}
	}

	return null;
}

export function snapshotMessage(message: APIMessage): ReportedMessage {
	return {
		messageId: message.id,
		channelId: message.channel_id,
		content: message.content.length > 0 ? message.content : null,
		imageUrl: firstImageUrl(message),
	};
}

export interface SubmitReportOptions {
	readonly guildId: string;
	readonly message: APIMessage;
	readonly reason: string;
	readonly reporter: APIInteractionGuildMember;
}

/**
 * Files a report for a message and gets the card in front of staff. Returns the line to show the reporter --
 * including for a refusal, which is an ordinary outcome here rather than an error: "you already reported this"
 * is information, not a failure.
 */
export async function submitMessageReport(options: SubmitReportOptions, logger: Logger): Promise<string> {
	// A guild with no reports channel is a guild that hasn't turned reporting on. Checked before anything is
	// written, so nothing accumulates in a queue nobody has anywhere to read.
	if (!(await getReportsChannelId(options.guildId))) {
		return REFUSAL_MESSAGES['reporting-disabled'];
	}

	// A bot's own message is reportable in principle but there is nothing useful staff can do to the account,
	// and the overwhelmingly common case is someone reporting AutoModerator's own card.
	if (options.message.author.bot) {
		return 'Bot messages cannot be reported.';
	}

	try {
		const result = await fileReport({
			guildId: options.guildId,
			target: actorFromUser(options.message.author),
			reporter: actorFromUser(options.reporter.user),
			reason: options.reason,
			message: snapshotMessage(options.message),
		});

		await syncReportCard(result.report, { reporterCount: result.reporterCount }, logger);

		return result.joined
			? 'Thanks — staff were already looking at this, and your report has been added to it.'
			: 'Thanks — this has been flagged to the staff team.';
	} catch (error) {
		if (error instanceof ReportFailure) {
			return error.message;
		}

		logger.error({ err: error, guildId: options.guildId }, 'failed to file a report');
		return 'Something went wrong filing that report. Please try again in a moment.';
	}
}

/**
 * Pulls the targeted message off a message context menu interaction. Discord resolves the whole message into
 * the payload, which is what makes the snapshot trustworthy -- it is Discord's copy of the message, not the
 * reporter's account of it.
 */
export function resolveTargetMessage(interaction: APIMessageApplicationCommandInteraction): APIMessage {
	return interaction.data.resolved.messages[interaction.data.target_id]!;
}

/**
 * The reasons the picker offers, oldest first. Bounded by the same constant the API enforces on create, so the
 * dashboard can never accept a preset this silently declines to show.
 */
export async function listReportPresets(guildId: string): Promise<string[]> {
	const rows = await getContext().db<{ reason: string }[]>`
		SELECT reason FROM automoderator_report_presets
		WHERE guild_id = ${guildId}
		ORDER BY id ASC
		LIMIT ${REPORT_PRESET_MAX_COUNT}
	`;

	return rows.map((row) => row.reason);
}
