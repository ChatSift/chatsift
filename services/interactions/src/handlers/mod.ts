import {
	ModCaseKind,
	type HandlerModule,
	type ICommandHandler,
	IDatabase,
	INotifier,
	PermissionsBitField,
} from '@automoderator/core';
import {
	API,
	ApplicationCommandOptionType,
	ButtonStyle,
	ComponentType,
	InteractionContextType,
	InteractionType,
	MessageFlags,
	PermissionFlagsBits,
	type APIApplicationCommandInteraction,
	type APIInteraction,
	type APIMessageComponentInteraction,
	type APIUser,
} from '@discordjs/core';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { ActionKind, HandlerStep, type InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { injectable } from 'inversify';
import { nanoid } from 'nanoid';
import { IComponentStateStore } from '../state/IComponentStateStore.js';

@injectable()
export default class ModHandler implements HandlerModule<CoralInteractionHandler> {
	public constructor(
		private readonly dataManager: IDatabase,
		private readonly notifier: INotifier,
		private readonly stateStore: IComponentStateStore,
		private readonly api: API,
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
			applicationCommands: [['warn:none:none', this.hanadleWarnCommand.bind(this)]],
			components: [
				['confirm-mod-case', this.handleConfirmModCase.bind(this)],
				['cancel-mod-case', this.handleCancelModCase.bind(this)],
			],
		});
	}

	private async *hanadleWarnCommand(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {
				flags: MessageFlags.Ephemeral,
			},
		});

		if (!options.getMember('target')) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'User is no longer in the server.',
					},
				},
				true,
			);
		}

		yield* this.checkHiararchy(interaction, options);
		yield* this.checkCaseLock(interaction, options, ModCaseKind.Warn);
	}

	private async *handleConfirmModCase(
		interaction: APIMessageComponentInteraction,
		args: string[],
	): CoralInteractionHandler {
		const id = args[0];
		if (!id) {
			throw new Error('Malformed custom_id');
		}

		const state = await this.stateStore.getPendingModCase(id);

		if (!state) {
			yield* HandlerStep.from({
				action: ActionKind.UpdateMessage,
				options: {
					content: 'This confirmation has expired.',
					components: [],
					embeds: [],
				},
			});
			return;
		}

		const target = await this.api.users.get(state.targetId);
		yield* this.commitCase(interaction, target, state.reason, state.kind);
	}

	private async *handleCancelModCase(): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.UpdateMessage,
			options: {
				content: 'Cancelled.',
				components: [],
				embeds: [],
			},
		});
	}

	private async *checkHiararchy(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): CoralInteractionHandler<void> {
		const targetMember = options.getMember('target', true);

		if (!targetMember) {
			return;
		}

		if (options.getUser('target', true).id === interaction.member!.user.id) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'You cannot mod yourself.',
					},
				},
				true,
			);
		}

		if (
			PermissionsBitField.any(BigInt(targetMember.permissions), [
				PermissionFlagsBits.ManageGuild,
				PermissionFlagsBits.Administrator,
			])
		) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'You cannot mod a user with Manage Guild or Administrator permissions.',
					},
				},
				true,
			);
		}

		const guildRoles = await this.api.guilds.getRoles(interaction.guild_id!);
		const sorted = guildRoles.sort((a, b) => b.position - a.position);

		const targetRolesSet = new Set(targetMember.roles);
		const highestTargetRole = sorted.find((role) => targetRolesSet.has(role.id));

		const modRolesSet = new Set(interaction.member!.roles);
		const highestModRole = sorted.find((role) => modRolesSet.has(role.id));

		if ((highestTargetRole?.position ?? 0) > (highestModRole?.position ?? 0)) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'You cannot mod a user with a higher role than you.',
						components: [],
						embeds: [],
					},
				},
				true,
			);
		}
	}

	private async *checkCaseLock(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
		kind: ModCaseKind,
	): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {
				flags: MessageFlags.Ephemeral,
			},
		});

		const target = options.getUser('target', true);
		const reason = options.getString('reason', true);

		const previousCases = await this.dataManager.getRecentCasesAgainst({
			guildId: interaction.guild_id!,
			targetId: target.id,
		});

		if (!previousCases.length) {
			yield* this.commitCase(interaction, target, reason, kind);
			return;
		}

		const embeds = previousCases.map((modCase) =>
			this.notifier.generateModCaseEmbed({ modCase, mod: interaction.member!.user, target }),
		);

		const stateId = nanoid();
		await this.stateStore.setPendingModCase(stateId, {
			kind,
			reason,
			targetId: target.id,
		});

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: 'This user has been actioned in the past hour. Would you still like to proceed?',
				embeds,
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								label: 'Yes',
								style: ButtonStyle.Success,
								type: ComponentType.Button,
								custom_id: `confirm-mod-case|${stateId}`,
							},
							{
								label: 'No',
								style: ButtonStyle.Danger,
								type: ComponentType.Button,
								custom_id: 'cancel-mod-case',
							},
						],
					},
				],
			},
		});
	}

	private async *commitCase(
		interaction: APIInteraction,
		target: APIUser,
		reason: string,
		kind: ModCaseKind,
	): CoralInteractionHandler {
		const isButton = interaction.type === InteractionType.MessageComponent;

		yield* HandlerStep.from(
			isButton
				? { action: ActionKind.EnsureDeferUpdateMessage }
				: {
						action: ActionKind.EnsureDeferReply,
						options: {
							flags: MessageFlags.Ephemeral,
						},
					},
		);

		const modCase = await this.dataManager.createModCase({
			guildId: interaction.guild_id!,
			targetId: target.id,
			modId: interaction.member!.user.id,
			reason,
			kind,
		});

		const userNotified = await this.notifier.tryNotifyTargetModCase(modCase);

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: `Successfully warned the user. DM sent: ${userNotified ? 'yes' : 'no'}`,
				components: [],
				embeds: [],
			},
		});

		yield* HandlerStep.from({
			action: ActionKind.ExecuteWithoutErrorReport,
			callback: async () => {
				await this.notifier.logModCase({ modCase, mod: interaction.member!.user, target });
			},
		});
	}
}
