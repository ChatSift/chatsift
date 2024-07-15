import {
	ModCaseKind,
	type HandlerModule,
	type ICommandHandler,
	IDatabase,
	INotifier,
	PermissionsBitField,
	type CaseWithLogMessage,
	parseRelativeTime,
	parseRelativeTimeUnsafe,
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
	type Snowflake,
} from '@discordjs/core';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { ActionKind, HandlerStep, type InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { injectable } from 'inversify';
import { nanoid } from 'nanoid';
import { IComponentStateStore, type ConfirmModCaseState } from '../state/IComponentStateStore.js';

@injectable()
export default class ModHandler implements HandlerModule<CoralInteractionHandler> {
	private readonly executeFirstKinds = new Set<ModCaseKind>([ModCaseKind.Kick, ModCaseKind.Ban]);

	public constructor(
		private readonly database: IDatabase,
		private readonly notifier: INotifier,
		private readonly stateStore: IComponentStateStore,
		private readonly api: API,
	) {}

	public register(handler: ICommandHandler<CoralInteractionHandler>) {
		const baseOptions = [
			{
				name: 'target',
				description: 'The user to action',
				type: ApplicationCommandOptionType.User,
				required: true,
			},
			{
				name: 'reason',
				description: 'The reason for the action',
				type: ApplicationCommandOptionType.String,
				required: true,
			},
			{
				name: 'references',
				description: 'References to other case IDs (comma seperated)',
				type: ApplicationCommandOptionType.String,
				required: false,
			},
		] as const;

		handler.register({
			interactions: [
				{
					name: 'warn',
					description: 'Warn a user',
					options: [...baseOptions],
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
				},
				{
					name: 'kick',
					description: 'Kick a user',
					options: [
						...baseOptions,
						{
							name: 'cleanup',
							description: "Delete the user's messages (known as a softban)",
							type: ApplicationCommandOptionType.Boolean,
							required: false,
						},
					],
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.KickMembers),
				},
			],
			applicationCommands: [
				['warn:none:none', this.hanadleWarnCommand.bind(this)],
				['kick:none:none', this.handleKickCommand.bind(this)],
			],
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

		const target = options.getUser('target', true);
		const reason = options.getString('reason', true);

		const references = yield* this.verifyValidReferences(options);
		yield* this.checkHiararchy(interaction, options);
		yield* this.checkCaseLock(interaction, options, ModCaseKind.Warn, references);

		yield* this.commitCase(
			interaction,
			target,
			reason,
			ModCaseKind.Warn,
			references,
			this.handleWarn(interaction.guild_id!, { reason, targetId: target.id, deleteMessageSeconds: null }),
		);
	}

	private async *handleKickCommand(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {
				flags: MessageFlags.Ephemeral,
			},
		});

		if (!options.getMember('target') && !options.getBoolean('cleanup')) {
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

		const target = options.getUser('target', true);
		const reason = options.getString('reason', true);

		const references = yield* this.verifyValidReferences(options);
		yield* this.checkHiararchy(interaction, options);
		yield* this.checkCaseLock(interaction, options, ModCaseKind.Kick, references);

		yield* this.commitCase(
			interaction,
			target,
			reason,
			ModCaseKind.Kick,
			references,
			this.handleKick(interaction.guild_id!, {
				targetId: target.id,
				reason,
				deleteMessageSeconds: options.getBoolean('cleanup') ? parseRelativeTimeUnsafe('7d') / 1_000 : null,
			}),
		);
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
		const references = await this.database.getModCaseBulk(state.references);

		// Dirty dity dirty evil. I don't want lots of hardcoding, so we do this and give the handler functions nice little
		// signatures that are always guildId, state.
		const handler = this[`handle${state.kind}`];

		yield* this.commitCase(
			interaction,
			target,
			state.reason,
			state.kind,
			references,
			handler(interaction.guild_id!, state),
		);
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

		const targetUser = options.getUser('target', true);

		if (targetUser.id === interaction.member!.user.id) {
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

		const guild = await this.api.guilds.get(interaction.guild_id!);
		if (guild.owner_id === targetUser.id) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'You cannot mod the owner of the server.',
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
		references: CaseWithLogMessage[],
	): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {
				flags: MessageFlags.Ephemeral,
			},
		});

		const target = options.getUser('target', true);
		const reason = options.getString('reason', true);

		const previousCases = await this.database.getRecentCasesAgainst({
			guildId: interaction.guild_id!,
			targetId: target.id,
		});

		if (!previousCases.length) {
			return;
		}

		const embeds = previousCases.map((modCase) =>
			this.notifier.generateModCaseEmbed({ modCase, mod: interaction.member!.user, target, references }),
		);

		const stateId = nanoid();
		await this.stateStore.setPendingModCase(stateId, {
			kind,
			reason,
			targetId: target.id,
			references: references.map((ref) => ref.id),
			deleteMessageSeconds:
				options.getBoolean('cleanup', false) ?? false ? parseRelativeTimeUnsafe('7d') / 1_000 : null,
		});

		yield* HandlerStep.from(
			{
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
			},
			true,
		);
	}

	private async *commitCase(
		interaction: APIInteraction,
		target: APIUser,
		reason: string,
		kind: ModCaseKind,
		references: CaseWithLogMessage[],
		executor: CoralInteractionHandler,
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

		const doFirst = this.executeFirstKinds.has(kind);
		if (doFirst) {
			yield* executor;
		}

		const modCase = await this.database.createModCase({
			guildId: interaction.guild_id!,
			targetId: target.id,
			modId: interaction.member!.user.id,
			reason,
			references: references.map((ref) => ref.id),
			kind,
		});

		const userNotified = await this.notifier.tryNotifyTargetModCase(modCase);

		if (!doFirst) {
			yield* executor;
		}

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: `Successfully ${this.notifier.ACTION_VERBS_MAP[kind]} the user. DM sent: ${userNotified ? 'yes' : 'no'}`,
				components: [],
				embeds: [],
			},
		});

		yield* HandlerStep.from({
			action: ActionKind.ExecuteWithoutErrorReport,
			callback: async () => {
				await this.notifier.logModCase({ modCase, mod: interaction.member!.user, target, references });
			},
		});
	}

	private async *verifyValidReferences(
		options: InteractionOptionResolver,
	): CoralInteractionHandler<CaseWithLogMessage[]> {
		const references =
			options
				.getString('references')
				?.split(',')
				.map((ref) => ref.trim()) ?? null;

		if (!references) {
			return [];
		}

		const numbers = references.map(Number);
		const invalidNumIndex = numbers.findIndex((num) => Number.isNaN(num));

		if (invalidNumIndex !== -1) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: `Reference case ID "${references[invalidNumIndex]}" is not a valid number.`,
					},
				},
				true,
			);
		}

		const cases = await this.database.getModCaseBulk(numbers);

		if (cases.length !== references.length) {
			const set = new Set(cases.map((cs) => cs.id));

			const invalid = numbers.filter((num) => !set.has(num));

			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: `Reference ID(s) ${invalid.join(', ')} do not exist.`,
					},
				},
				true,
			);
		}

		return cases;
	}

	// no-op
	private async *handleWarn(
		guildId: Snowflake,
		state: Omit<ConfirmModCaseState, 'kind' | 'references'>,
	): CoralInteractionHandler {}

	// no-op.. for now
	private async *handleTimeout(
		guildId: Snowflake,
		state: Omit<ConfirmModCaseState, 'kind' | 'references'>,
	): CoralInteractionHandler {}

	// no-op.. for now
	private async *handleUntimeout(
		guildId: Snowflake,
		state: Omit<ConfirmModCaseState, 'kind' | 'references'>,
	): CoralInteractionHandler {}

	// eslint-disable-next-line require-yield
	private async *handleKick(
		guildId: Snowflake,
		state: Omit<ConfirmModCaseState, 'kind' | 'references'>,
	): CoralInteractionHandler {
		if (state.deleteMessageSeconds) {
			await this.api.guilds.banUser(
				guildId,
				state.targetId,
				{
					delete_message_seconds: state.deleteMessageSeconds,
				},
				{ reason: `Kick with cleanup (softban) | ${state.reason}` },
			);
			await this.api.guilds.unbanUser(guildId, state.targetId, {
				reason: `Kick with cleanup (softban) | ${state.reason}`,
			});
		} else {
			await this.api.guilds.removeMember(guildId, state.targetId, { reason: state.reason });
		}
	}

	private async *handleBan(
		guildId: Snowflake,
		state: Omit<ConfirmModCaseState, 'kind' | 'references'>,
	): CoralInteractionHandler {}

	private async *handleUnban(
		guildId: Snowflake,
		state: Omit<ConfirmModCaseState, 'kind' | 'references'>,
	): CoralInteractionHandler {}
}
