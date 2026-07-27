import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { isMarkedDeleted, isUnknownMessageError, markEmbedDeleted } from '../lib/replyModeration.js';
import { findOpenThreadByModThreadId, findStaffReplyByLocalId } from '../lib/threads.js';

export default class DeleteCommand implements CommandHandler {
	public readonly name = 'delete';

	public readonly data = new ChatInputCommandBuilder()
		.setName('delete')
		.setDescription("Delete a past staff reply from the user's side of this ModMail ticket by its Reply ID")
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.addIntegerOptions((option) =>
			option
				.setName('id')
				.setDescription('The Reply ID shown in this ticket’s mod-forum log message footer')
				.setRequired(true)
				.setMinValue(1),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger) {
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

		// See `edit.ts` for why this is pulled into a standalone `const` rather than read off `thread`
		// repeatedly -- keeps the null-narrowing intact across the `await`s below.
		const userThreadId = thread.userThreadId;
		if (!userThreadId) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This ticket has no active user thread to delete a reply from.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const replyId = options.getInteger('id', true);
		const staffId = interaction.member.user.id;

		const row = await findStaffReplyByLocalId(thread.id, replyId);
		if (!row) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: `No staff reply with Reply ID #${replyId} was found in this ticket.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await getContext().service.client.api.interactions.defer(interaction.id, interaction.token, {
			flags: MessageFlags.Ephemeral,
		});

		try {
			const logMessage = await getContext().service.client.api.channels.getMessage(
				thread.modThreadId,
				row.guildMessageId,
			);
			const logEmbed = logMessage.embeds[0];
			if (!logEmbed) {
				throw new Error(`Reply ${replyId} in thread ${thread.id}'s log message has no embed`);
			}

			if (isMarkedDeleted(logEmbed)) {
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: `Reply #${replyId} was already deleted.`,
				});
				return;
			}

			try {
				await getContext().service.client.api.channels.deleteMessage(userThreadId, row.userMessageId, {
					reason: `Reply #${replyId} deleted by ${staffId} via /delete`,
				});
			} catch (error) {
				// Already gone (e.g. the user deleted it themselves, or the private thread is otherwise
				// missing it) -- proceed to mark the log entry deleted anyway, idempotently matching what
				// actually happened rather than failing the command over state that's already correct.
				if (!isUnknownMessageError(error)) {
					throw error;
				}
			}

			await getContext().service.client.api.channels.editMessage(thread.modThreadId, row.guildMessageId, {
				embeds: [markEmbedDeleted(logEmbed, staffId)],
			});

			logger.info({ threadId: thread.id, replyId }, 'Deleted staff reply');
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: `✅ Reply #${replyId} deleted. It's gone from the user's side; the mod-forum log now shows it as deleted.`,
			});
		} catch (error) {
			logger.error({ err: error, threadId: thread.id, replyId }, 'Failed to delete staff reply');
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: '❌ Failed to delete that reply. Please try again or reach out for support.',
			});
		}
	}
}
