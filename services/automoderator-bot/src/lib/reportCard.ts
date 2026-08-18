import type { Logger } from '@chatsift/backend-core';
import {
	getContext,
	listReportMessages,
	getReportsChannelId,
	reportDetailLink,
	setReportCard,
} from '@chatsift/backend-core';
import type { ReportCardOptions, ReportEmbedInput, ReportOriginName, ReportStateName } from '@chatsift/core';
import { buildReportComponents, buildReportEmbeds } from '@chatsift/core';
import type { AutomoderatorReports } from '@chatsift/db';
import type { APIMessage } from '@discordjs/core';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { executeAction } from './actionExecutor.js';

export type { ReportCardOptions } from '@chatsift/core';
export { REPORT_ACTION_OPTIONS, REPORT_COMPONENT, isReportAction } from '@chatsift/core';
export type { ReportActionName } from '@chatsift/core';

/**
 * Narrows a row to the structural shape `@chatsift/core`'s builders take. The two enum columns come back as
 * kanel enum types that `@chatsift/db` only re-exports the *type* of, hence the casts -- the same arrangement
 * `caseFormat.ts` needs for `actionType`.
 */
export function reportEmbedInput(report: AutomoderatorReports): ReportEmbedInput {
	return {
		...report,
		origin: report.origin as unknown as ReportOriginName,
		state: report.state as unknown as ReportStateName,
	};
}

export function buildReportEmbed(report: AutomoderatorReports, options: ReportCardOptions) {
	return buildReportEmbeds(reportEmbedInput(report), options);
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
	const input = reportEmbedInput(report);

	// Read back rather than threaded through from the caller: every path that rewrites a card (four button
	// handlers, the action modal) would otherwise have to remember to carry them, and forgetting would silently
	// drop half a DM report's evidence on the next redraw. Empty for a guild report, which is every report the
	// bot itself files.
	const contextMessages = report.origin === 'DM' ? await listReportMessages(report.id) : [];

	const body = {
		embeds: buildReportEmbeds(input, {
			...options,
			contextMessages,
			dashboardLink: reportDetailLink(report.guildId, report.id),
		}),
		components: buildReportComponents(input),
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
		// `UnknownChannel` as well as `UnknownMessage`: deleting the whole reports channel is at least as likely as
		// deleting one card, and without it the row keeps pointing at a dead channel forever and every future
		// transition silently fails to render. Forgetting the card makes the next one post fresh into whatever
		// channel is configured then -- the same self-heal `dispatchCaseLog` does for its webhook.
		if (
			error instanceof DiscordAPIError &&
			(error.code === RESTJSONErrorCodes.UnknownMessage || error.code === RESTJSONErrorCodes.UnknownChannel)
		) {
			await setReportCard(report.id, null);
			logger.warn({ guildId: report.guildId, reportId: report.id, code: error.code }, 'report card is gone, forgot it');
			return;
		}

		// Swallowed rather than rethrown, unlike a moderation action: the report row is already committed and the
		// dashboard queue shows it, so a card that failed to post is a degraded surface rather than lost work.
		// The reporter has already been told their report went through, and it did.
		logger.error({ err: error, guildId: report.guildId, reportId: report.id }, 'failed to sync a report card');
	}
}
