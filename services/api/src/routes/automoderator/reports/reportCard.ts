import {
	getContext,
	getOriginatingReporterId,
	getReportsChannelId,
	listReportMessages,
	reportDetailLink,
	reportEmbedInput,
	setReportCard,
} from '@chatsift/backend-core';
import { buildReportComponents, buildReportEmbeds } from '@chatsift/core';
import type { AutomoderatorReports } from '@chatsift/db';
import { apiForGuild } from '../../../util/discordAPI.js';

/**
 * Posts the card for a report filed from the website (P3b's DM reports).
 *
 * `services/automoderator-bot` has the same function for the reports it files, and the two deliberately share
 * the builders in `@chatsift/core` rather than one of them owning the card -- exactly the arrangement
 * `refreshCaseLog` already has with the bot's `dispatchCaseLog`. The buttons carry the bot's own custom-id
 * prefixes, and it handles them regardless of which process posted the message, because it is the same
 * application either way.
 *
 * Never throws. The report row is committed by the time this runs and the dashboard queue already shows it, so
 * a card that failed to post is a degraded surface rather than lost work -- and the reporter has already been
 * told their report went through, because it did.
 */
export async function postReportCard(report: AutomoderatorReports, reporterCount: number): Promise<void> {
	const context = getContext();

	const channelId = await getReportsChannelId(report.guildId);
	if (!channelId) {
		return;
	}

	const input = reportEmbedInput(report);

	try {
		const [contextMessages, reporterId] = await Promise.all([
			listReportMessages(report.id),
			getOriginatingReporterId(report.id),
		]);

		const posted = await apiForGuild('AUTOMODERATOR', report.guildId).channels.createMessage(channelId, {
			embeds: buildReportEmbeds(input, {
				reporterCount,
				contextMessages,
				...(reporterId ? { reporterId } : {}),
				dashboardLink: reportDetailLink(report.guildId, report.id),
			}),
			components: buildReportComponents(input),
		});

		await setReportCard(report.id, { channelId, messageId: posted.id });
	} catch (error) {
		context.logger.warn(
			{ err: error, guildId: report.guildId, reportId: report.id },
			'failed to post a card for a DM report',
		);
	}
}
