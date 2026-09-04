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

/**
 * The display label doubles as the routing key -- see `historyContextMenu.ts`.
 */
const LABEL = 'Report Message';

const PRESET_SELECT_ID = 'preset';
const REASON_INPUT_ID = 'reason';

const MODAL_TIMEOUT_MS = 5 * 60 * 1_000;

const REASON_MAX_LENGTH = 500;

/**
 * The only way a member reports a message. Deliberately carries **no** `setDefaultMemberPermissions`: reporting
 * is what ordinary members do, and gating it would leave the feature usable only by the people who don't need it.
 *
 * Shipped alongside a one-click `Report Message` until #394, on the theory that a reason picker in front of the
 * fast path is how a report queue ends up empty. In practice the pair only made the menu ambiguous, and a report
 * with no reason on it is one staff have to reconstruct from the message alone.
 */
export default class ReportMessageContextMenuCommand implements CommandHandler {
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
									// The reason text *is* the value, not its index in this list. A preset added, removed or
									// renamed while the modal sits open (up to five minutes) shifts every index after it, so an
									// index would resolve to a different reason than the reporter picked -- or fall out of range
									// and silently drop it. `REPORT_PRESET_MAX_LENGTH` is 100 and a select value allows 100, so
									// the text always fits, and carrying it means nothing has to be re-read on submit.
									options: presets.map((reason) => ({ label: reason, value: reason })),
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
		const preset = hasPresets ? readOptionalSelectedString(options, PRESET_SELECT_ID) : null;

		// Both halves are joined when both are filled, so a preset plus context reads as one reason rather than
		// the free text silently winning.
		const reason = [preset, typed].filter(Boolean).join(' - ');

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
