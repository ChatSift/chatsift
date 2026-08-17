import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { actorFromUser } from '../lib/cases.js';
import { REPORT_COMPONENT } from '../lib/reportCard.js';
import { refreshCard, resolveCardInteraction } from '../lib/reportComponents.js';
import { REPORT_STATE, setReportState } from '../lib/reports.js';

export default class ReportDismissComponent implements ComponentHandler<string> {
	public readonly name = REPORT_COMPONENT.dismiss;

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, reportId: string, logger: Logger): Promise<void> {
		const resolved = await resolveCardInteraction(interaction, reportId, logger);
		if (!resolved) {
			return;
		}

		const { report, member } = resolved;
		const api = getContext().service.client.api;

		// The button is rendered disabled for an actioned report, but a card that hasn't been refreshed since
		// somebody actioned it still has a live one -- and without this, clicking it would walk an ACTIONED report
		// back to DISMISSED and orphan the case it produced.
		if (report.state === REPORT_STATE.ACTIONED) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'This report has already been actioned.',
				flags: MessageFlags.Ephemeral,
			});

			// Rewritten anyway, so the stale card the click came from picks up its disabled buttons.
			await refreshCard(report, logger);
			return;
		}

		// Acknowledged with a no-op deferred update rather than a reply: the visible result is the card being
		// rewritten below, and a "done" message alongside it would just be noise in a busy channel.
		await api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		const next = report.state === REPORT_STATE.DISMISSED ? REPORT_STATE.OPEN : REPORT_STATE.DISMISSED;
		const updated = await setReportState(report.id, { state: next, moderator: actorFromUser(member.user) });

		await refreshCard(updated, logger);
	}
}
