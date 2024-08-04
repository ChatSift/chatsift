import { InteractionContextType, type APIApplicationCommandInteraction } from '@discordjs/core';
import { ActionKind, HandlerStep, type InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { injectable } from 'inversify';
import { Env } from '../../Env.js';
import { type HandlerModule, ICommandHandler } from '../ICommandHandler.js';

@injectable()
export default class DevHandler implements HandlerModule<CoralInteractionHandler> {
	public constructor(private readonly handler: ICommandHandler<CoralInteractionHandler>) {}

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

	public async *handleDeploy(interaction: APIApplicationCommandInteraction): CoralInteractionHandler {
		if (!interaction.user) {
			throw new Error('Command /deploy was ran in non-dm.');
		}

		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {},
		});

		if (!Env.ADMINS.has(interaction.user.id)) {
			yield* HandlerStep.from({
				action: ActionKind.Reply,
				options: {
					content: 'You are not authorized to use this command',
				},
			});
			return;
		}

		await this.handler.deployCommands();
		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: 'Successfully deployed commands',
			},
		});
	}
}
