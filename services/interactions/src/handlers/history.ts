import { IDatabase, INotifier, type HandlerModule, type ICommandHandler } from '@automoderator/core';
import {
	ApplicationCommandOptionType,
	InteractionContextType,
	PermissionFlagsBits,
	type APIApplicationCommandInteraction,
} from '@discordjs/core';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { ActionKind, HandlerStep, type InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { injectable } from 'inversify';

@injectable()
export default class HistoryHandler implements HandlerModule<CoralInteractionHandler> {
	public constructor(
		private readonly database: IDatabase,
		private readonly notifier: INotifier,
	) {}

	public register(handler: ICommandHandler<CoralInteractionHandler>) {
		handler.register({
			interactions: [
				{
					name: 'history',
					description: 'View the mod history of a user',
					options: [
						{
							name: 'target',
							type: ApplicationCommandOptionType.User,
							description: 'The user to view the history of',
							required: true,
						},
						{
							name: 'page',
							type: ApplicationCommandOptionType.Integer,
							description: 'The page number to view',
							min_value: 1,
							required: false,
						},
					],
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
				},
			],
			applicationCommands: [['history:none:none', this.handle.bind(this)]],
		});
	}

	public async *handle(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {},
		});

		const target = options.getUser('target', true);
		const page = (options.getInteger('page') ?? 1) - 1;

		const cases = await this.database.getModCasesAgainst({ targetId: target.id, guildId: interaction.guild_id!, page });
		if (!cases.length) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content:
							page === 0 ? 'No mod history found for this user' : 'No mod history found for this user on this page',
					},
				},
				true,
			);
		}

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: `Mod history for ${target.username}; page ${page + 1}`,
				embeds: cases.map((cs) =>
					this.notifier.generateModCaseEmbed({ mod: null, modCase: cs, references: [], target }),
				),
			},
		});
	}
}
