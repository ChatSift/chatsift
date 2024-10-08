import {
	ModCaseKind,
	type HandlerModule,
	type ICommandHandler,
	IDatabase,
	INotifier,
	PermissionsBitField,
	type CaseWithLogMessage,
} from '@automoderator/core';
import { parseRelativeTime, parseRelativeTimeSafe } from '@chatsift/parse-relative-time';
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
	type APIApplicationCommandOption,
	type APIInteraction,
	type APIMessageComponentInteraction,
	type APIUser,
	type Snowflake,
} from '@discordjs/core';
import { time } from '@discordjs/formatters';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { ActionKind, HandlerStep, type InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { injectable } from 'inversify';
import { nanoid } from 'nanoid';
import { REFERENCES_OPTION, verifyValidCaseReferences } from '../helpers/verifyValidCaseReferences.js';
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
		const baseOptionsWith = (...additional: APIApplicationCommandOption[]): APIApplicationCommandOption[] => [
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
			...additional,
			REFERENCES_OPTION,
		];

		handler.register({
			interactions: [
				{
					name: 'warn',
					description: 'Warn a user',
					options: baseOptionsWith(),
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
				},
				{
					name: 'kick',
					description: 'Kick a user',
					options: baseOptionsWith({
						name: 'cleanup',
						description: "Delete the user's messages (known as a softban)",
						type: ApplicationCommandOptionType.Boolean,
						required: false,
					}),
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.KickMembers),
				},
				{
					name: 'timeout',
					description: 'Timeout a user',
					options: baseOptionsWith({
						name: 'duration',
						description: 'The duration for the timeout. Between 1 minute and 28 days.',
						type: ApplicationCommandOptionType.String,
						required: true,
					}),
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
				},
				{
					name: 'unban',
					description: 'Unban a user',
					options: baseOptionsWith(),
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.BanMembers),
				},
				{
					name: 'untimeout',
					description: 'Untimeout a user',
					options: baseOptionsWith(),
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
				},
				{
					name: 'ban',
					description: 'Ban a user',
					options: baseOptionsWith({
						name: 'cleanup',
						description: "Specify how far back to go deleting the user's messages (e.g. 8h)",
						type: ApplicationCommandOptionType.String,
						required: false,
					}),
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.BanMembers),
				},
			],
			applicationCommands: [
				['warn:none:none', this.hanadleWarnCommand.bind(this)],
				['kick:none:none', this.handleKickCommand.bind(this)],
				['timeout:none:none', this.handleTimeoutCommand.bind(this)],
				['unban:none:none', this.handleUnbanCommand.bind(this)],
				['untimeout:none:none', this.handleUntimeoutCommand.bind(this)],
				['ban:none:none', this.handleBanCommand.bind(this)],
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

		const references = yield* verifyValidCaseReferences(options, this.database);
		yield* this.checkHiararchy(interaction, options);
		yield* this.checkCaseLock(interaction, options, ModCaseKind.Warn, references);
		yield* this.commitCase(
			interaction,
			target,
			{ reason, kind: ModCaseKind.Warn, deleteMessageSeconds: null, timeoutDuration: null },
			references,
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
		const deleteMessageSeconds = options.getBoolean('cleanup') ? parseRelativeTime('1d') / 1_000 : null;

		const references = yield* verifyValidCaseReferences(options, this.database);
		yield* this.checkHiararchy(interaction, options);
		yield* this.checkCaseLock(interaction, options, ModCaseKind.Kick, references);

		yield* this.commitCase(
			interaction,
			target,
			{ kind: ModCaseKind.Kick, reason, deleteMessageSeconds, timeoutDuration: null },
			references,
		);
	}

	private async *handleTimeoutCommand(
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
		const durationStr = options.getString('duration', true);

		const parsed = parseRelativeTimeSafe(durationStr);
		if (!parsed.ok) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: `Invalid duration: ${parsed.message}`,
					},
				},
				true,
			);
			// Obviously redundant, but asserts parsed.ok is true for later
			return;
		}

		if (parsed.value < parseRelativeTime('1m') || parsed.value > parseRelativeTime('28d')) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'Timeout duration must be between 1 minute and 28 days.',
					},
				},
				true,
			);
		}

		const references = yield* verifyValidCaseReferences(options, this.database);
		yield* this.checkHiararchy(interaction, options);
		yield* this.checkCaseLock(interaction, options, ModCaseKind.Timeout, references);
		yield* this.commitCase(
			interaction,
			target,
			{ kind: ModCaseKind.Timeout, reason, deleteMessageSeconds: null, timeoutDuration: parsed.value },
			references,
		);
	}

	private async *handleUnbanCommand(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {
				flags: MessageFlags.Ephemeral,
			},
		});

		const target = options.getUser('target', true);

		const ban = await this.api.guilds.getMemberBan(interaction.guild_id!, target.id).catch(() => null);
		if (!ban) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'User is not banned.',
					},
				},
				true,
			);
		}

		const reason = options.getString('reason', true);
		const references = yield* verifyValidCaseReferences(options, this.database);
		yield* this.checkHiararchy(interaction, options);
		yield* this.checkCaseLock(interaction, options, ModCaseKind.Unban, references);
		yield* this.commitCase(
			interaction,
			target,
			{ reason, kind: ModCaseKind.Unban, deleteMessageSeconds: null, timeoutDuration: null },
			references,
		);
	}

	private async *handleUntimeoutCommand(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {
				flags: MessageFlags.Ephemeral,
			},
		});

		const member = options.getMember('target');
		if (!member) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'User is no longer in the server.',
					},
				},
				true,
			);
			return;
		}

		if (!member.communication_disabled_until) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'User is not timed out.',
					},
				},
				true,
			);
		}

		const target = options.getUser('target', true);
		const reason = options.getString('reason', true);
		const references = yield* verifyValidCaseReferences(options, this.database);
		yield* this.checkHiararchy(interaction, options);
		yield* this.checkCaseLock(interaction, options, ModCaseKind.Untimeout, references);
		yield* this.commitCase(
			interaction,
			target,
			{ reason, kind: ModCaseKind.Untimeout, deleteMessageSeconds: null, timeoutDuration: null },
			references,
		);
	}

	private async *handleBanCommand(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {
				flags: MessageFlags.Ephemeral,
			},
		});

		const target = options.getUser('target', true);
		const reason = options.getString('reason', true);

		const durationStr = options.getString('cleanup', false);
		let deleteMessageSeconds: number | null = null;

		if (durationStr) {
			const parsed = parseRelativeTimeSafe(durationStr);
			if (!parsed.ok) {
				yield* HandlerStep.from(
					{
						action: ActionKind.Reply,
						options: {
							content: `Invalid duration: ${parsed.message}`,
						},
					},
					true,
				);
				// Obviously redundant, but asserts parsed.ok is true for later
				return;
			}

			if (parsed.value < parseRelativeTime('1m') || parsed.value > parseRelativeTime('7d')) {
				yield* HandlerStep.from(
					{
						action: ActionKind.Reply,
						options: {
							content: 'Ban duration must be between 1 minute and 7 days.',
						},
					},
					true,
				);
			}

			deleteMessageSeconds = parsed.value / 1_000;
		}

		const references = yield* verifyValidCaseReferences(options, this.database);
		yield* this.checkHiararchy(interaction, options);
		yield* this.checkCaseLock(interaction, options, ModCaseKind.Ban, references);

		yield* this.commitCase(
			interaction,
			target,
			{ kind: ModCaseKind.Ban, reason, deleteMessageSeconds, timeoutDuration: null },
			references,
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

		yield* this.commitCase(interaction, target, state, references);
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

		const previousCases = await this.database.getRecentModCasesAgainst({
			guildId: interaction.guild_id!,
			targetId: target.id,
		});

		if (!previousCases.length) {
			return;
		}

		const historyEmbed = this.notifier.generateHistoryEmbed({
			cases: previousCases,
			target,
		});

		const stateId = nanoid();
		await this.stateStore.setPendingModCase(stateId, {
			kind,
			reason,
			targetId: target.id,
			references: references.map((ref) => ref.id),
			deleteMessageSeconds: (options.getBoolean('cleanup', false) ?? false) ? parseRelativeTime('1d') / 1_000 : null,
			timeoutDuration: options.getString('duration', false)
				? parseRelativeTime(options.getString('duration', true))
				: null,
		});

		yield* HandlerStep.from(
			{
				action: ActionKind.Reply,
				options: {
					content:
						'This user has been actioned in the past hour. Would you still like to proceed? Note that the logs below do not include some information, refer to your log channel for details such as references.',
					embeds: [historyEmbed],
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
		state: Omit<ConfirmModCaseState, 'references' | 'targetId'>,
		references: CaseWithLogMessage[],
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

		const doFirst = this.executeFirstKinds.has(state.kind);
		const handler = this[`handle${state.kind}`].bind(this);

		if (doFirst) {
			yield* handler(interaction.guild_id!, { ...state, targetId: target.id });
		}

		const modCase = await this.database.createModCase({
			guildId: interaction.guild_id!,
			targetId: target.id,
			modId: interaction.member!.user.id,
			reason: state.timeoutDuration
				? `${state.reason} | Until ${time(new Date(Date.now() + state.timeoutDuration))}`
				: state.reason,
			references: references.map((ref) => ref.id),
			kind: state.kind,
		});

		const userNotified = await this.notifier.tryNotifyTargetModCase(modCase);

		if (!doFirst) {
			yield* handler(interaction.guild_id!, { ...state, targetId: target.id });
		}

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: `Successfully ${this.notifier.ACTION_VERBS_MAP[state.kind]} the user. DM sent: ${userNotified ? 'yes' : 'no'}`,
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

	/* eslint-disable require-yield */

	private async *handleWarn(
		guildId: Snowflake,
		state: Omit<ConfirmModCaseState, 'kind' | 'references'>,
	): CoralInteractionHandler {
		// no-op
	}

	private async *handleTimeout(
		guildId: Snowflake,
		state: Omit<ConfirmModCaseState, 'kind' | 'references'>,
	): CoralInteractionHandler {
		await this.api.guilds.editMember(
			guildId,
			state.targetId,
			{
				communication_disabled_until: new Date(Date.now() + state.timeoutDuration!).toISOString(),
			},
			{ reason: state.reason },
		);
	}

	private async *handleUntimeout(
		guildId: Snowflake,
		state: Omit<ConfirmModCaseState, 'kind' | 'references'>,
	): CoralInteractionHandler {
		await this.api.guilds.editMember(
			guildId,
			state.targetId,
			{
				communication_disabled_until: null,
			},
			{ reason: state.reason },
		);
	}

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
	): CoralInteractionHandler {
		await this.api.guilds.banUser(
			guildId,
			state.targetId,
			{
				delete_message_seconds: state.deleteMessageSeconds ?? undefined,
			},
			{ reason: state.reason },
		);
	}

	private async *handleUnban(
		guildId: Snowflake,
		state: Omit<ConfirmModCaseState, 'kind' | 'references'>,
	): CoralInteractionHandler {
		await this.api.guilds.unbanUser(guildId, state.targetId, { reason: state.reason });
	}

	/* eslint-enable require-yield */
}
