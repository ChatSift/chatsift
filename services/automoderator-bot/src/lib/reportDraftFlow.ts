import type { Logger, ReportDraftMessage } from '@chatsift/backend-core';
import {
	addReportDraftMessage,
	getReportDraft,
	mintReportDraftToken,
	REPORT_DRAFT_MAX_MESSAGES,
	REPORT_DRAFT_TOKEN_TTL_MINUTES,
	REPORT_DRAFT_TTL_MINUTES,
	reportDraftLink,
	splitDraft,
} from '@chatsift/backend-core';
import type { APIMessage, APIUser } from '@discordjs/core';
import { formatUserTag } from './cases.js';
import { firstImageUrl } from './reportFlow.js';

/**
 * The DM half of reporting (P3b). Someone harassed in a DM has no guild to report from, so the context menu
 * accumulates Discord's *own* copy of the messages they pick into a redis draft, and `/submit-report` hands
 * them a link that finishes the job on the website -- which is the only place the "which of your servers is
 * this for?" question can be answered, because the OAuth `guilds` scope is the user-to-guild index a bot
 * process does not have.
 *
 * Everything here returns the line to show the reporter rather than replying itself, so the two commands stay
 * thin and the wording lives in one place.
 */

/**
 * A draft snapshot. Unlike `snapshotMessage` in `reportFlow.ts` this carries the author and the timestamp: a
 * DM draft can legitimately include the reporter's own replies, so "who wrote this" stops being derivable from
 * the report's target the way it is for a guild report.
 */
export function snapshotDraftMessage(message: APIMessage, author: APIUser): ReportDraftMessage {
	return {
		messageId: message.id,
		channelId: message.channel_id,
		author: { id: author.id, tag: formatUserTag(author) },
		content: message.content.length > 0 ? message.content : null,
		imageUrl: firstImageUrl(message),
		timestamp: message.timestamp,
	};
}

export interface AddToDraftOptions {
	readonly message: APIMessage;
	readonly reporter: APIUser;
}

/**
 * Adds one message to the caller's draft and returns what to tell them.
 */
export async function addToReportDraft(options: AddToDraftOptions, logger: Logger): Promise<string> {
	// A bot's messages are reportable in principle and useless in practice -- there is nothing staff can do to
	// the account -- and the overwhelmingly likely case here is somebody adding one of AutoModerator's own DMs.
	// Same refusal the guild context menus give.
	if (options.message.author.bot) {
		return 'Bot messages cannot be added to a report.';
	}

	try {
		const result = await addReportDraftMessage(
			options.reporter.id,
			snapshotDraftMessage(options.message, options.message.author),
		);

		switch (result.refusal) {
			case 'duplicate':
				return 'That message is already in your report draft.';
			case 'different-channel':
				// Deliberately explicit about the rule rather than vague: unlike the server picker later on, there is
				// no third party whose privacy is protected by being cagey here, and a reporter who doesn't
				// understand why the message was refused will just try again.
				return (
					'A report can only cover one conversation. You already have a draft going from a different chat — ' +
					'submit it with `/submit-report`, or run `/submit-report` and cancel to start fresh.'
				);
			case 'full':
				return `A report can hold at most ${REPORT_DRAFT_MAX_MESSAGES} messages. Submit this one with \`/submit-report\` first.`;
			case null:
				break;
		}

		const count = result.draft.messages.length;
		const plural = count === 1 ? 'message' : 'messages';

		return (
			`Added — your report draft now has ${count} ${plural}.\n\n` +
			`Add more with this same menu if the conversation needs context (up to ${REPORT_DRAFT_MAX_MESSAGES}), ` +
			`then run \`/submit-report\` to choose which server to send it to. ` +
			`The draft is kept for ${REPORT_DRAFT_TTL_MINUTES} minutes after your last addition.`
		);
	} catch (error) {
		logger.error({ err: error, reporterId: options.reporter.id }, 'failed to add a message to a report draft');
		return 'Something went wrong saving that. Please try again in a moment.';
	}
}

/**
 * Mints the link that finishes a draft on the website, or explains why there is nothing to submit.
 */
export async function submitReportDraft(reporter: APIUser, logger: Logger): Promise<string> {
	try {
		const draft = await getReportDraft(reporter.id);
		if (!draft?.messages.length) {
			return (
				'You have no report draft. Find the message you want to report, open its ⋯ menu, and pick ' +
				'**Apps → Add to Report Draft** first.'
			);
		}

		// Checked here rather than left for the website, because the reporter can still fix it at this point --
		// they are one context-menu click away from adding the message that gives the report a subject. Finding
		// out after an OAuth round trip would be a worse place to learn it.
		if (!splitDraft(draft, reporter.id)) {
			return (
				'Your draft only contains your own messages, so there is nobody to report. Add at least one message ' +
				'from the other person.'
			);
		}

		const token = await mintReportDraftToken(reporter.id);
		const count = draft.messages.length;
		const plural = count === 1 ? 'message' : 'messages';

		return (
			`Finish your report here: ${reportDraftLink(token)}\n\n` +
			`You'll be asked to log in with Discord and pick which server to send it to — only servers you share ` +
			`with them that accept reports will be listed. Your ${count} ${plural} will be shown back to you before ` +
			`anything is sent. This link works for ${REPORT_DRAFT_TOKEN_TTL_MINUTES} minutes and only for your account.`
		);
	} catch (error) {
		logger.error({ err: error, reporterId: reporter.id }, 'failed to mint a report draft token');
		return 'Something went wrong. Please try again in a moment.';
	}
}
