import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { reportDetailLink } from '../lib/dashboardLinks.js';
import { REPORT_COMPONENT } from '../lib/reportCard.js';
import { resolveCardInteraction } from '../lib/reportComponents.js';
import { listReporters } from '../lib/reports.js';

/**
 * Discord's message content cap. A report with a hundred reporters is rare, but one where each reporter wrote
 * a hundred characters of reason is not -- so the list is truncated rather than allowed to 400.
 */
const CONTENT_LIMIT = 1_900;

export default class ReportReportersComponent implements ComponentHandler<string> {
	public readonly name = REPORT_COMPONENT.reporters;

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, reportId: string, logger: Logger): Promise<void> {
		const resolved = await resolveCardInteraction(interaction, reportId, logger);
		if (!resolved) {
			return;
		}

		const reporters = await listReporters(resolved.report.id);

		const lines: string[] = [];
		let dropped = 0;

		for (const reporter of reporters) {
			const line = `• ${reporter.reporterTag} (<@${reporter.reporterId}>): ${reporter.reason}`;

			if (lines.join('\n').length + line.length + 1 > CONTENT_LIMIT) {
				dropped += 1;
				continue;
			}

			lines.push(line);
		}

		if (dropped > 0) {
			// Linked rather than just named: telling someone to "see the dashboard" without saying where is the
			// kind of message that gets written once and never followed.
			lines.push(
				`…and ${dropped} more — [see them all on the dashboard](${reportDetailLink(
					resolved.report.guildId,
					resolved.report.id,
				)})`,
			);
		}

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: lines.length > 0 ? lines.join('\n') : 'Nobody is on this report, which should not be possible.',
			flags: MessageFlags.Ephemeral,
			allowed_mentions: { parse: [] },
		});
	}
}
