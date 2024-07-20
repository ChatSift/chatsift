import type { HandlerModule, ICommandHandler, IDatabase } from '@automoderator/core';
import { computeModalFields } from '@automoderator/core/src/util/computeModalFields.js';
import {
	API,
	ApplicationCommandType,
	ComponentType,
	InteractionContextType,
	MessageFlags,
	TextInputStyle,
	type APIApplicationCommandInteraction,
	type APIModalSubmitInteraction,
} from '@discordjs/core';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { ActionKind, HandlerStep, type InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { injectable } from 'inversify';

@injectable()
export default class ReportHandler implements HandlerModule<CoralInteractionHandler> {
	public constructor(
		private readonly database: IDatabase,
		private readonly api: API,
	) {}

	public register(handler: ICommandHandler<CoralInteractionHandler>) {
		handler.register({
			interactions: [
				{
					name: 'Report Message',
					type: ApplicationCommandType.Message,
					contexts: [InteractionContextType.Guild],
				},
			],
			applicationCommands: [['Report Message:none:none', this.handle.bind(this)]],
			modals: [['report-modal', this.handleModal.bind(this)]],
		});
	}

	public async *handle(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): CoralInteractionHandler {
		const { reportChannelId } = await this.database.getSettings(interaction.guild_id!);
		if (!reportChannelId) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'No report channel has been set up in this community.',
						flags: MessageFlags.Ephemeral,
					},
				},
				true,
			);
		}

		const message = options.getTargetMessage();

		yield* HandlerStep.from({
			action: ActionKind.OpenModal,
			options: {
				custom_id: `report-modal|${message.channel_id}|${message.id}`,
				title: 'Report Message',
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								label: 'Reason',
								type: ComponentType.TextInput,
								custom_id: 'report-reason',
								required: true,
								style: TextInputStyle.Paragraph,
							},
						],
					},
				],
			},
		});
	}

	private async *handleModal(
		interaction: APIModalSubmitInteraction,
		[channelId, messageId]: string[],
	): CoralInteractionHandler {
		if (!channelId || !messageId) {
			throw new Error('Malformed custom_id');
		}

		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {
				content: 'Forwarding...',
			},
		});

		const message = await this.api.channels.getMessage(channelId, messageId);
		const fields = computeModalFields(interaction.data);
		const reason = fields.get('report-reason')!;

		const { reportChannelId } = await this.database.getSettings(interaction.guild_id!);
	}
}
