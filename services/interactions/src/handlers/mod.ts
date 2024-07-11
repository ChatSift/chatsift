import { ModCaseKind, type HandlerModule, type ICommandHandler, IDataManager, INotifier } from '@automoderator/core';
import {
	ApplicationCommandOptionType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
	type APIInteraction,
	type APIUser,
} from '@discordjs/core';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { ActionKind, type InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { injectable } from 'inversify';

@injectable()
export default class ModHandler implements HandlerModule<CoralInteractionHandler> {
	public constructor(
		private readonly dataManager: IDataManager,
		private readonly notifier: INotifier,
	) {}

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

	private async *hanadleWarn(interaction: APIInteraction, options: InteractionOptionResolver): CoralInteractionHandler {
		yield {
			action: ActionKind.EnsureDefer,
			data: {
				flags: MessageFlags.Ephemeral,
			},
		};

		yield* this.checkCaseLock(interaction, options, ModCaseKind.Warn);
	}

	private async *checkCaseLock(
		interaction: APIInteraction,
		options: InteractionOptionResolver,
		kind: ModCaseKind,
	): CoralInteractionHandler {
		yield {
			action: ActionKind.EnsureDefer,
			data: {
				flags: MessageFlags.Ephemeral,
			},
		};

		const target = options.getUser('target', true);

		const previousCases = await this.dataManager.getRecentCasesAgainst({
			guildId: interaction.guild_id!,
			targetId: target.id,
		});

		if (!previousCases.length) {
			yield* this.commitCase(interaction, options, kind);
			return;
		}

		const embeds = await Promise.all(
			previousCases.map(async (modCase) =>
				this.notifier.generateModCaseEmbed({ modCase, mod: interaction.member!.user, target }),
			),
		);

		yield {
			action: ActionKind.Respond,
			data: {
				content: 'This user has been actioned in the past hour. Would you still like to proceed?',
				embeds,
				// TODO
				components: [],
			},
		};
	}

	private async *commitCase(
		interaction: APIInteraction,
		options: InteractionOptionResolver,
		kind: ModCaseKind,
	): CoralInteractionHandler {
		const target = options.getUser('target', true);
		const reason = options.getString('reason', true);

		const modCase = await this.dataManager.createModCase({
			guildId: interaction.guild_id!,
			targetId: target.id,
			modId: interaction.member!.user.id,
			reason,
			kind,
		});

		const userNotified = await this.notifier.tryNotifyTargetModCase(modCase);

		yield {
			action: ActionKind.Respond,
			data: {
				content: `Successfully warned the user. DM sent: ${userNotified ? 'yes' : 'no'}`,
			},
		};

		yield {
			action: ActionKind.ExecuteWithoutErrorReport,
			callback: async () => {
				await this.notifier.logModCase({ modCase, mod: interaction.member!.user, target });
			},
		};
	}
}
