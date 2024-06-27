import { API, InteractionContextType, type APIInteraction } from '@discordjs/core';
import { injectable } from 'inversify';
import type { Env } from '../../util/Env.js';
import type { ApplicationCommandHandler, HandlerModule, ICommandHandler } from '../ICommandHandler.js';

@injectable()
export default class DevHandler implements HandlerModule {
	public constructor(
		private readonly api: API,
		private readonly handler: ICommandHandler,
		private readonly env: Env,
	) {}

	public register() {
		this.handler.register({
			interactions: [
				{
					name: 'deploy',
					description: 'Deploy commands',
					options: [],
					contexts: [InteractionContextType.BotDM],
				},
			],
			applicationCommands: [['deploy:none:none', this.handleDeploy]],
		});
	}

	private readonly handleDeploy: ApplicationCommandHandler = async (interaction: APIInteraction) => {
		if (!interaction.user) {
			throw new Error('Command /deploy was ran in non-dm.');
		}

		if (!this.env.admins.has(interaction.user.id)) {
			await this.api.interactions.reply(interaction.id, interaction.token, {
				content: 'You are not authorized to use this command',
			});

			return;
		}

		await this.handler.deployCommands();

		await this.api.interactions.reply(interaction.id, interaction.token, { content: 'Successfully deployed commands' });
	};
}
