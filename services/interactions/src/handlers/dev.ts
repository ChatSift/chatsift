import { API } from '@discordjs/core';
import { injectable } from 'inversify';
import { InteractionsService, type CommandHandler, type Handler } from '../interactions.js';

/**
 * @remarks
 * Special dev commands not handled in this service, as they're scoped to a guild.
 */
@injectable()
export default class Dev implements Handler {
	public constructor(
		private readonly interactions: InteractionsService,
		private readonly api: API,
	) {}

	public register() {
		this.interactions.register({
			commands: [['deploy:none:none', this.handleDeploy]],
		});
	}

	private readonly handleDeploy: CommandHandler = async (interaction) => {
		await this.interactions.deployCommands();
		await this.api.interactions.reply(interaction.id, interaction.token, { content: 'Successfully deployed commands' });
	};
}
