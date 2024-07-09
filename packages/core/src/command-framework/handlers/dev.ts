import { InteractionContextType, type APIInteraction } from '@discordjs/core';
import { ActionKind, type InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { injectable } from 'inversify';
import type { Env } from '../../util/Env.js';
import type { HandlerModule, ICommandHandler } from '../ICommandHandler.js';

@injectable()
export default class DevHandler implements HandlerModule<CoralInteractionHandler> {
	public constructor(
		private readonly handler: ICommandHandler<CoralInteractionHandler>,
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
			applicationCommands: [['deploy:none:none', this.handleDeploy.bind(this)]],
		});
	}

	public async *handleDeploy(interaction: APIInteraction): CoralInteractionHandler {
		if (!interaction.user) {
			throw new Error('Command /deploy was ran in non-dm.');
		}

		if (!this.env.admins.has(interaction.user.id)) {
			return {
				action: ActionKind.Respond,
				data: {
					content: 'You are not authorized to use this command',
				},
			};
		}

		await this.handler.deployCommands();
		yield {
			action: ActionKind.Respond,
			data: {
				content: 'Successfully deployed commands',
			},
		};
	}
}
