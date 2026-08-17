import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { collectModal, readOptionalSelectedString, readOptionalTextInput } from '@chatsift/bot-core';
import { MessageContextCommandBuilder } from '@discordjs/builders';
import type {
	APIApplicationCommandInteraction,
	APIMessage,
	APIMessageApplicationCommandInteraction,
	APIModalInteractionResponseCallbackData,
	APIModalSubmitInteraction,
	APIInteractionGuildMember,
} from '@discordjs/core';
import {
	ApplicationIntegrationType,
	ComponentType,
	InteractionContextType,
	MessageFlags,
	TextInputStyle,
} from '@discordjs/core';
import { ModalInteractionOptionResolver } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';
import { listReportPresets, resolveTargetMessage, submitMessageReport } from '../lib/reportFlow.js';

const LABEL = 'Report Message with Reason';

const PRESET_SELECT_ID = 'preset';
const REASON_INPUT_ID = 'reason';

const MODAL_TIMEOUT_MS = 5 * 60 * 1_000;

const REASON_MAX_LENGTH = 500;

export default class ReportMessageWithReasonContextMenuCommand implements CommandHandler {
	public readonly name = LABEL;

	public readonly data = new MessageContextCommandBuilder()
		.setName(LABEL)
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		if (!interaction.guild_id || !interaction.member) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'This can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const message = resolveTargetMessage(interaction as APIMessageApplicationCommandInteraction);
		const presets = await listReportPresets(interaction.guild_id);

		const modalId = nanoid();
		await api.interactions.createModal(interaction.id, interaction.token, this.buildModal(modalId, presets));

		let modal: APIModalSubmitInteraction;
		try {
			modal = await collectModal(modalId, MODAL_TIMEOUT_MS);
		} catch {
			await api.interactions.followUp(interaction.application_id, interaction.token, {
				content: "You didn't submit that in time. Use the menu again when you're ready.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await this.handleSubmission(modal, message, interaction.guild_id, interaction.member, presets.length > 0, logger);
	}

	private buildModal(modalId: string, presets: readonly string[]): APIModalInteractionResponseCallbackData {
		const hasPresets = presets.length > 0;

		return {
			custom_id: modalId,
			title: 'Report message',
			components: [
				...(hasPresets
					? [
							{
								type: ComponentType.Label as const,
								label: 'Reason',
								description: 'Pick the closest match, or leave this and describe it below.',
								component: {
									type: ComponentType.StringSelect as const,
									custom_id: PRESET_SELECT_ID,
									required: false,
									min_values: 0,
									max_values: 1,
									options: presets.map((reason, index) => ({ label: reason, value: String(index) })),
								},
							},
						]
					: []),
				{
					type: ComponentType.Label as const,
					label: hasPresets ? 'Anything else?' : 'Reason',
					component: {
						type: ComponentType.TextInput as const,
						custom_id: REASON_INPUT_ID,
						style: TextInputStyle.Paragraph as const,
						placeholder: 'This is what the staff team will see.',
						required: !hasPresets,
						max_length: REASON_MAX_LENGTH,
						...(hasPresets ? {} : { min_length: 5 }),
					},
				},
			],
		};
	}

	private async handleSubmission(
		modal: APIModalSubmitInteraction,
		message: APIMessage,
		guildId: string,
		reporter: APIInteractionGuildMember,
		hasPresets: boolean,
		logger: Logger,
	): Promise<void> {
		const api = getContext().service.client.api;
		await api.interactions.defer(modal.id, modal.token, { flags: MessageFlags.Ephemeral });

		const options = new ModalInteractionOptionResolver(modal);
		const typed = readOptionalTextInput(options, REASON_INPUT_ID);
		const picked = hasPresets ? readOptionalSelectedString(options, PRESET_SELECT_ID) : null;

		const presets = picked === null ? [] : await listReportPresets(guildId);
		const preset = picked === null ? null : (presets[Number(picked)] ?? null);

		const reason = [preset, typed].filter(Boolean).join(' — ');

		if (!reason) {
			await api.interactions.editReply(modal.application_id, modal.token, {
				content: 'You need to pick a reason or describe the problem.',
			});
			return;
		}

		const content = await submitMessageReport({ guildId, message, reporter, reason }, logger);
		await api.interactions.editReply(modal.application_id, modal.token, { content });
	}
}
