import { API } from '@discordjs/core';
import { ApplicationCommandType } from 'discord-api-types/v10';
import { inject, injectable } from 'inversify';
import { InteractionsService, type CommandHandler, type Handler } from '../interactions.js';

@injectable()
export default class Deploy implements Handler {
	@inject(InteractionsService)
	private readonly interactions!: InteractionsService;

	@inject(API)
	private readonly api!: API;

	public register() {
		this.interactions.register({
			interaction: {
				name: 'deploy',
				description: '(Dev) deploy global slash commands',
				type: ApplicationCommandType.ChatInput,
				default_member_permissions: '0',
				dm_permission: false,
				options: [],
			},
			commands: [['deploy:none:none', this.handle]],
		});
	}

	private readonly handle: CommandHandler = async (interaction) => {
		await this.interactions.deployCommands();
		await this.api.interactions.reply(interaction.id, interaction.token, { content: 'Successfully deployed commands' });
	};
}
