import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { buildForeignEmojiRejection, fetchGuildEmojiIds, findForeignEmojiTokens } from '../lib/emojis.js';
import { relayStaffReplyToUserThread, UndeliverableUserError } from '../lib/relay.js';
import { findOpenThreadByModThreadId } from '../lib/threads.js';

export default class ReplyQuickCommand implements CommandHandler {
	public readonly name = 'reply-q';

	public readonly data = new ChatInputCommandBuilder()
		.setName('reply-q')
		.setDescription('Quickly reply to this ModMail ticket with a single-line message')
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.addStringOptions((option) =>
			option.setName('content').setDescription('The message to send').setRequired(true).setMaxLength(4_000),
		)
		.addBooleanOptions((option) => option.setName('anon').setDescription('Send anonymously').setRequired(false))
		.addBooleanOptions((option) =>
			option.setName('ping').setDescription('Mention the user with this reply').setRequired(false),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger) {
		// Deferred immediately -- unlike `/reply` (modal-driven, its own ack comes from `createModal`),
		// this command goes straight from the initial interaction into the same relay call (media
		// re-upload + two message posts) that comfortably outlasts Discord's 3-second ack window. Every
		// branch below responds via `editReply` against this defer instead of a fresh `reply` -- without
		// it, a slow or failed relay left this interaction with no response at all ("The application did
		// not respond"), which is exactly what an undeliverable-DM failure (#216, P4/P5) used to do.
		await getContext().service.client.api.interactions.defer(interaction.id, interaction.token, {
			flags: MessageFlags.Ephemeral,
		});

		const editReply = async (content: string) => {
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content,
			});
		};

		if (!interaction.guild_id || !interaction.channel || !interaction.member) {
			await editReply('This command can only be used in a server.');
			return;
		}

		const thread = await findOpenThreadByModThreadId(interaction.channel.id);
		if (!thread) {
			await editReply('This command can only be used inside an open ModMail ticket thread.');
			return;
		}

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const content = options.getString('content', true);
		const anon = options.getBoolean('anon') ?? false;
		const ping = options.getBoolean('ping') ?? false;

		const guildEmojiIds = await fetchGuildEmojiIds(interaction.guild_id, getContext().service.client.api, logger);
		if (!guildEmojiIds) {
			await editReply("⚠️ Couldn't verify this server's emotes right now. Please try again in a moment.");
			return;
		}

		const foreignEmojiTokens = findForeignEmojiTokens(content, guildEmojiIds);
		if (foreignEmojiTokens.length > 0) {
			await getContext().service.client.api.interactions.editReply(
				interaction.application_id,
				interaction.token,
				buildForeignEmojiRejection(foreignEmojiTokens, content),
			);
			return;
		}

		try {
			await relayStaffReplyToUserThread({
				anon,
				content,
				logger,
				ping,
				staffMember: interaction.member,
				staffUser: interaction.member.user,
				thread,
			});
		} catch (error) {
			if (error instanceof UndeliverableUserError) {
				logger.warn({ err: error, threadId: thread.id }, 'Reply could not be delivered to the user');
				await editReply(
					"❌ Couldn't deliver that reply — the user has DMs closed or left the server. Nothing was sent.",
				);
				return;
			}

			logger.error({ err: error, threadId: thread.id }, 'Failed to relay staff reply');
			await editReply('❌ Failed to send that reply. Please try again or reach out for support.');
			return;
		}

		await editReply('✅ Reply sent.');
	}
}
