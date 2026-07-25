import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { collectModal } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type {
	APIApplicationCommandInteraction,
	APIChatInputApplicationCommandInteraction,
	APIModalSubmitGuildInteraction,
} from '@discordjs/core';
import {
	ApplicationIntegrationType,
	ComponentType,
	InteractionContextType,
	MessageFlags,
	TextInputStyle,
} from '@discordjs/core';
import { ChatInputInteractionOptionResolver, ModalInteractionOptionResolver } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';
import { relayStaffReplyToUserThread } from '../lib/relay.js';
import { findOpenThreadByModThreadId } from '../lib/threads.js';

export default class ReplyCommand implements CommandHandler {
	public readonly name = 'reply';

	public readonly data = new ChatInputCommandBuilder()
		.setName('reply')
		.setDescription('Reply to this ModMail ticket (opens a box for the message content)')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.addBooleanOptions((option) => option.setName('anon').setDescription('Send anonymously').setRequired(false))
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

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const anon = options.getBoolean('anon') ?? false;

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

		const modalInteraction = (await collectModal(id, 5 * 60 * 1_000)) as APIModalSubmitGuildInteraction;
		const modalOptions = new ModalInteractionOptionResolver(modalInteraction);
		const content = modalOptions.getTextInput('content');
		const attachments = modalOptions.getAttachments('attachments') ?? [];

		await relayStaffReplyToUserThread({
			anon,
			attachments,
			content,
			logger,
			staffMember: modalInteraction.member,
			staffUser: modalInteraction.member.user,
			thread,
		});

		await getContext().service.client.api.interactions.reply(modalInteraction.id, modalInteraction.token, {
			content: '✅ Reply sent.',
			flags: MessageFlags.Ephemeral,
		});
	}
}
