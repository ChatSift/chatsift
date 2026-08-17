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

		const overflowLine = (count: number) =>
			// Linked rather than just named: telling someone to "see the dashboard" without saying where is the
			// kind of message that gets written once and never followed.
			`…and ${count} more — [see them all on the dashboard](${reportDetailLink(
				resolved.report.guildId,
				resolved.report.id,
			)})`;

		// The overflow line's own length is reserved up front, because it is long (it carries a full dashboard
		// URL) and appending it *after* filling the budget is how the reply ends up over Discord's 2000-character
		// cap — which fails the interaction outright instead of showing a truncated list.
		const budget = CONTENT_LIMIT - overflowLine(reporters.length).length;

		const lines: string[] = [];
		let used = 0;

		for (const reporter of reporters) {
			const line = `• ${reporter.reporterTag} (<@${reporter.reporterId}>): ${reporter.reason}`;

			// Stops at the first line that doesn't fit rather than skipping it and carrying on, so what staff read
			// is a prefix of the real order instead of an arbitrary subset with the long entries silently missing.
			if (used + line.length + 1 > budget) {
				break;
			}

			lines.push(line);
			used += line.length + 1;
		}

		const dropped = reporters.length - lines.length;
		if (dropped > 0) {
			lines.push(overflowLine(dropped));
		}

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: lines.length > 0 ? lines.join('\n') : 'Nobody is on this report, which should not be possible.',
			flags: MessageFlags.Ephemeral,
			allowed_mentions: { parse: [] },
		});
	}
}
