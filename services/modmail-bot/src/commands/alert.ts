import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags } from '@discordjs/core';
import { findOpenThreadByModThreadId } from '../lib/threads.js';

export default class AlertCommand implements CommandHandler {
	public readonly name = 'alert';

	public readonly data = new ChatInputCommandBuilder()
		.setName('alert')
		.setDescription('Toggle a ping for yourself whenever the user sends a new message in this ticket')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, _logger: Logger) {
		if (!interaction.guild_id || !interaction.channel || !interaction.member) {
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

		const userId = interaction.member.user.id;

		const [existing] = await getContext().db<[{ userId: string }?]>`
			SELECT user_id FROM thread_reply_alerts WHERE thread_id = ${thread.id} AND user_id = ${userId}
		`;

		let content: string;
		if (existing) {
			await getContext().db`
				DELETE FROM thread_reply_alerts WHERE thread_id = ${thread.id} AND user_id = ${userId}
			`;
			content = '🔕 You will no longer be pinged about new messages in this ticket.';
		} else {
			await getContext().db`
				INSERT INTO thread_reply_alerts (thread_id, user_id) VALUES (${thread.id}, ${userId})
			`;
			content = "🔔 You'll be pinged when the user sends a new message in this ticket.";
		}

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content,
			flags: MessageFlags.Ephemeral,
		});
	}
}
