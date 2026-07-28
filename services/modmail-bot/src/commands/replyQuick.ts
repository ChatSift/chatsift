import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { buildForeignEmojiRejection, fetchGuildEmojiIds, findForeignEmojiTokens } from '../lib/emojis.js';
import { relayStaffReplyToUserThread } from '../lib/relay.js';
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

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const content = options.getString('content', true);
		const anon = options.getBoolean('anon') ?? false;
		const ping = options.getBoolean('ping') ?? false;

		const guildEmojiIds = await fetchGuildEmojiIds(interaction.guild_id, getContext().service.client.api, logger);
		if (!guildEmojiIds) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: "⚠️ Couldn't verify this server's emotes right now. Please try again in a moment.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const foreignEmojiTokens = findForeignEmojiTokens(content, guildEmojiIds);
		if (foreignEmojiTokens.length > 0) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				...buildForeignEmojiRejection(foreignEmojiTokens, content),
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await relayStaffReplyToUserThread({
			anon,
			content,
			logger,
			ping,
			staffMember: interaction.member,
			staffUser: interaction.member.user,
			thread,
		});

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: '✅ Reply sent.',
			flags: MessageFlags.Ephemeral,
		});
	}
}
