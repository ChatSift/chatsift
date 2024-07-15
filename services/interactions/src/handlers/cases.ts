import {
	promiseAllObject,
	type CaseWithLogMessage,
	type HandlerModule,
	type ICommandHandler,
	IDatabase,
	INotifier,
} from '@automoderator/core';
import {
	API,
	ApplicationCommandOptionType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
	type APIApplicationCommandInteraction,
	type APIMessageComponentInteraction,
	type Snowflake,
} from '@discordjs/core';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { ActionKind, HandlerStep, type InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { injectable } from 'inversify';
import type { Selectable } from 'kysely';
import { REFERENCES_OPTION, verifyValidCaseReferences } from '../helpers/verifyValidCaseReferences.js';

@injectable()
export default class ModHandler implements HandlerModule<CoralInteractionHandler> {
	public constructor(
		private readonly database: IDatabase,
		private readonly notifier: INotifier,
		private readonly api: API,
	) {}

	public register(handler: ICommandHandler<CoralInteractionHandler>): void {
		const idOption = {
			name: 'id',
			description: 'The case number',
			type: ApplicationCommandOptionType.Integer,
			required: true,
		} as const;

		handler.register({
			interactions: [
				{
					name: 'cases',
					description: 'Manage mod cases',
					options: [
						{
							name: 'edit',
							description: 'Edit a case',
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								idOption,
								{
									name: 'reason',
									description: 'The reason for the action',
									type: ApplicationCommandOptionType.String,
									required: false,
								},
								REFERENCES_OPTION,
							],
						},
						{
							name: 'delete',
							description: 'Delete a case',
							type: ApplicationCommandOptionType.Subcommand,
							options: [idOption],
						},
					],
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
				},
			],
			applicationCommands: [
				['cases:none:edit', this.handleCaseEdit.bind(this)],
				['cases:none:delete', this.handleCaseDelete.bind(this)],
			],
			components: [
				['confirm-mod-case-delete', this.handleConfirmModCaseDelete.bind(this)],
				['cancel-mod-case-delete', this.handleCancelModCaseDelete.bind(this)],
			],
		});
	}

	private async *handleCaseEdit(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {
				flags: MessageFlags.Ephemeral,
			},
		});

		const cs = yield* this.verifyCaseExists(interaction.guild_id!, options.getInteger('id', true));

		const reason = options.getString('reason', false) ?? undefined;
		const references = yield* verifyValidCaseReferences(options, this.database);

		const updated = await this.database.updateModCase(cs.id, { reason, references: references.map((ref) => ref.id) });

		const existingMessage = updated.logMessage
			? await this.api.channels.getMessage(updated.logMessage.channelId, updated.logMessage.messageId).catch(() => null)
			: null;

		if (existingMessage) {
			await this.notifier.logModCase({ mod: null, modCase: updated, references, target: null, existingMessage });
		}

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: `Case #${cs.id} has been updated. If it was previously not logged, it has been now.`,
			},
		});
	}

	private async *handleCaseDelete(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {
				flags: MessageFlags.Ephemeral,
			},
		});

		const cs = yield* this.verifyCaseExists(interaction.guild_id!, options.getInteger('id', true));

		const { mod, target, references } = await promiseAllObject({
			mod: this.api.users.get(cs.modId).catch(() => null),
			target: this.api.users.get(cs.targetId).catch(() => null),
			references: this.database.getModCaseReferences(cs.id),
		});

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: `Are you sure you want to delete case #${cs.id}?`,
				embeds: [this.notifier.generateModCaseEmbed({ modCase: cs, mod, target, references })],
			},
		});
	}

	private async *handleConfirmModCaseDelete(
		interaction: APIMessageComponentInteraction,
		args: string[],
	): CoralInteractionHandler {
		if (!args[0]) {
			throw new Error('Malformed custom_id');
		}

		yield* HandlerStep.from({ action: ActionKind.EnsureDeferUpdateMessage });

		const csId = Number(args[0]);
		await this.database.deleteModCase(csId);

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: `Case #${csId} has been deleted. If a log exists, it will remain as-is.`,
				embeds: [],
				components: [],
			},
		});
	}

	private async *handleCancelModCaseDelete() {
		yield* HandlerStep.from({
			action: ActionKind.UpdateMessage,
			options: {
				content: 'Cancelled.',
				embeds: [],
				components: [],
			},
		});
	}

	private async *verifyCaseExists(
		guildId: Snowflake,
		caseId: number,
	): CoralInteractionHandler<Selectable<CaseWithLogMessage>> {
		const cs = await this.database.getModCase(caseId);

		if (!cs || cs.guildId !== guildId) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: `Case ID ${caseId} does not exist.`,
					},
				},
				true,
			);
		}

		return cs!;
	}
}
