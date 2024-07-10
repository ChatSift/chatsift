import { ModCaseKind, type HandlerModule, type ICommandHandler, type IDataManager } from '@automoderator/core';
import {
	ApplicationCommandOptionType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
	type APIInteraction,
} from '@discordjs/core';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { ActionKind, type InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { injectable } from 'inversify';

@injectable()
export default class ModHandler implements HandlerModule<CoralInteractionHandler> {
	public constructor(private readonly dataManager: IDataManager) {}

	public register(handler: ICommandHandler<CoralInteractionHandler>) {
		handler.register({
			interactions: [
				{
					name: 'warn',
					description: 'Warn a user',
					options: [
						{
							name: 'target',
							description: 'The user to warn',
							type: ApplicationCommandOptionType.User,
							required: true,
						},
						{
							name: 'reason',
							description: 'The reason for the warning',
							type: ApplicationCommandOptionType.String,
							required: true,
						},
					],
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
				},
			],
			applicationCommands: [['warn:none:none', this.hanadleWarn.bind(this)]],
		});
	}

	public async *hanadleWarn(interaction: APIInteraction, options: InteractionOptionResolver): CoralInteractionHandler {
		if (!interaction.guild_id) {
			throw new Error('This command can only be used in a guild');
		}

		yield {
			action: ActionKind.EnsureDefer,
			data: {
				flags: MessageFlags.Ephemeral,
			},
		};

		const target = options.getUser('target', true);
		const reason = options.getString('reason', true);

		const modCase = await this.dataManager.createModCase({
			guildId: interaction.guild_id,
			userId: target.id,
			modId: interaction.member!.user.id,
			reason,
			kind: ModCaseKind.Warn,
		});

		yield {
			action: ActionKind.Respond,
			data: {
				content: 'Successfully warned the user. DM sent: ',
			},
		};
	}
}
