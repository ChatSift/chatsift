import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { APPEAL_COMPONENT } from '@chatsift/core';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { describeUndecidable, refreshAppealCard, resolveAppealInteraction } from '../lib/appealComponents.js';
import { runAppealDecision } from '../lib/appealDecisions.js';

/**
 * Approving lifts the ban, so it asks for nothing first -- there is no reason field, because the appellant
 * finds out by being unbanned and P6's DM says the same. The two denial buttons are the ones that open a modal.
 */
export default class AppealApproveComponent implements ComponentHandler<string> {
	public readonly name = APPEAL_COMPONENT.approve;

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, appealId: string, logger: Logger): Promise<void> {
		const resolved = await resolveAppealInteraction(interaction, appealId, logger);
		if (!resolved) {
			return;
		}

		const api = getContext().service.client.api;

		// The buttons render disabled once an appeal is decided, and a card nobody has clicked since then still
		// carries live ones -- so this is the check that stops a second decision, not the rendering.
		const blocked = describeUndecidable(resolved.appeal);
		if (blocked) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: blocked,
				flags: MessageFlags.Ephemeral,
			});

			await refreshAppealCard(resolved.appeal, logger);
			return;
		}

		// A no-op deferred update rather than a reply: the visible result is the card being rewritten, and the
		// follow-up below is reserved for the cases where that is not the whole story.
		await api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		const line = await runAppealDecision(
			{ appeal: resolved.appeal, decision: 'approved', member: resolved.member, reason: null },
			logger,
		);

		await api.interactions.followUp(interaction.application_id, interaction.token, {
			content: line,
			flags: MessageFlags.Ephemeral,
		});
	}
}
