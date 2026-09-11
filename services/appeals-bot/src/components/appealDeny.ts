import type { Logger } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { APPEAL_COMPONENT } from '@chatsift/core';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { handleAppealDenial } from '../lib/appealDenyFlow.js';

export default class AppealDenyComponent implements ComponentHandler<string> {
	public readonly name = APPEAL_COMPONENT.deny;

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, appealId: string, logger: Logger): Promise<void> {
		await handleAppealDenial(interaction, appealId, false, logger);
	}
}
