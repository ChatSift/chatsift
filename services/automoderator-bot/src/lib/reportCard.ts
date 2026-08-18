import type { Logger } from '@chatsift/backend-core';
import {
	getContext,
	getOriginatingReporterId,
	getReportsChannelId,
	listReportMessages,
	reportDetailLink,
	reportEmbedInput,
	setReportCard,
} from '@chatsift/backend-core';
import type { ReportCardOptions } from '@chatsift/core';
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
	// drop half a DM report's evidence on the next redraw. Only a DM report has either, which is why neither
	// query runs for the guild reports this bot files itself.
	const [contextMessages, reporterId] =
		report.origin === 'DM'
			? await Promise.all([listReportMessages(report.id), getOriginatingReporterId(report.id)])
			: [[], null];

	const body = {
		embeds: buildReportEmbeds(input, {
			...options,
			contextMessages,
			...(reporterId ? { reporterId } : {}),
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
