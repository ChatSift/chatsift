import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { collectModal } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIModalSubmitGuildInteraction } from '@discordjs/core';
import {
	ApplicationIntegrationType,
	ComponentType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
	TextInputStyle,
} from '@discordjs/core';
import { ModalInteractionOptionResolver } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';
import { buildForeignEmojiRejection, fetchGuildEmojiIds, findForeignEmojiTokens } from '../lib/emojis.js';
import { relayStaffReplyToUserThread, UndeliverableUserError } from '../lib/relay.js';
import { findOpenThreadByModThreadId } from '../lib/threads.js';

/**
 * `ModalInteractionOptionResolver` has no dedicated checkbox getter (discord-api-types added
 * `Checkbox` after the resolver's helper methods were written), so this narrows the generic
 * `.get()` result itself.
 */
function getCheckboxValue(modalOptions: ModalInteractionOptionResolver, customId: string): boolean {
	const component = modalOptions.get(customId);
	return component.type === ComponentType.Checkbox && component.value;
}

export default class ReplyCommand implements CommandHandler {
	public readonly name = 'reply';

	public readonly data = new ChatInputCommandBuilder()
		.setName('reply')
		.setDescription('Reply to this ModMail ticket (opens a box for the message content)')
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger) {
		if (!interaction.guild_id || !interaction.channel) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const thread = await findOpenThreadByModThreadId(interaction.channel.id);
		if (!thread) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used inside an open ModMail ticket thread.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const id = nanoid();
		await getContext().service.client.api.interactions.createModal(interaction.id, interaction.token, {
			custom_id: id,
			title: 'Reply to ticket',
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							custom_id: 'content',
							type: ComponentType.TextInput,
							label: 'Message',
							style: TextInputStyle.Paragraph,
							min_length: 1,
							max_length: 4_000,
							required: true,
						},
					],
				},
				{
					type: ComponentType.Label,
					label: 'Send anonymously',
					description: "Hide your identity behind the server's name instead of your own.",
					component: {
						type: ComponentType.Checkbox,
						custom_id: 'anon',
					},
				},
				{
					type: ComponentType.Label,
					label: 'Ping with this reply',
					description: 'Mention the user so they get notified.',
					component: {
						type: ComponentType.Checkbox,
						custom_id: 'ping',
					},
				},
				{
					type: ComponentType.Label,
					label: 'Attachments (optional)',
					description: 'Images or files to send along with the reply.',
					component: {
						type: ComponentType.FileUpload,
						custom_id: 'attachments',
						required: false,
						min_values: 1,
						max_values: 3,
					},
				},
			],
		});

		let modalInteraction: APIModalSubmitGuildInteraction;
		try {
			modalInteraction = (await collectModal(id, 5 * 60 * 1_000)) as APIModalSubmitGuildInteraction;
		} catch {
			// Timing out is a routine outcome (staff opened the modal and never submitted it), not a bug --
			// letting the rejection propagate would crash the whole bot (it surfaces as an unhandled rejection
			// on the shared `InteractionCreate` listener in bot-core's `client.ts`, which has no 'error' handler).
			await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: "⌛ You didn't submit that in time. Run `/reply` again when you're ready.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Deferred immediately, before the relay (media re-upload + two message posts) — that easily
		// outlasts Discord's 3-second ack window, and without a defer the final `editReply` below would
		// otherwise be racing an interaction that's already timed out.
		await getContext().service.client.api.interactions.defer(modalInteraction.id, modalInteraction.token, {
			flags: MessageFlags.Ephemeral,
		});

		const modalOptions = new ModalInteractionOptionResolver(modalInteraction);
		const content = modalOptions.getTextInput('content');
		const attachments = modalOptions.getAttachments('attachments') ?? [];
		const anon = getCheckboxValue(modalOptions, 'anon');
		const ping = getCheckboxValue(modalOptions, 'ping');

		const guildEmojiIds = await fetchGuildEmojiIds(modalInteraction.guild_id, getContext().service.client.api, logger);
		if (!guildEmojiIds) {
			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{
					content: "⚠️ Couldn't verify this server's emotes right now. Please try `/reply` again in a moment.",
				},
			);
			return;
		}

		const foreignEmojiTokens = findForeignEmojiTokens(content, guildEmojiIds);
		if (foreignEmojiTokens.length > 0) {
			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				buildForeignEmojiRejection(foreignEmojiTokens, content),
			);
			return;
		}

		try {
			await relayStaffReplyToUserThread({
				anon,
				attachments,
				content,
				logger,
				ping,
				staffMember: modalInteraction.member,
				staffUser: modalInteraction.member.user,
				thread,
			});

			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{
					content: '✅ Reply sent.',
				},
			);
		} catch (error) {
			if (error instanceof UndeliverableUserError) {
				logger.warn({ err: error, threadId: thread.id }, 'Reply could not be delivered to the user');
				await getContext().service.client.api.interactions.editReply(
					modalInteraction.application_id,
					modalInteraction.token,
					{
						content: "❌ Couldn't deliver that reply - the user has DMs closed or left the server. Nothing was sent.",
					},
				);
				return;
			}

			logger.error({ err: error, threadId: thread.id }, 'Failed to relay staff reply');
			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{
					content: '❌ Failed to send that reply. Please try again or reach out for support.',
				},
			);
		}
	}
}
