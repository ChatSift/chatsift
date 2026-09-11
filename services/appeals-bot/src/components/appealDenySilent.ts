import type { Logger } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { APPEAL_COMPONENT } from '@chatsift/core';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { handleAppealDenial } from '../lib/appealDenyFlow.js';

/**
 * Decision 6: terminal and closed for moderators, indefinitely invisible to the appellant. Everything that
 * makes it different from an ordinary denial lives in `handleAppealDenial` and in the card's own wording --
 * this is the same button pointed at the other audience.
 */
export default class AppealDenySilentComponent implements ComponentHandler<string> {
	public readonly name = APPEAL_COMPONENT.denySilent;

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, appealId: string, logger: Logger): Promise<void> {
		await handleAppealDenial(interaction, appealId, true, logger);
	}
}
