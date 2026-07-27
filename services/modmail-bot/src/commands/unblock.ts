import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { findOpenThreadByModThreadId } from '../lib/threads.js';

export default class UnblockCommand implements CommandHandler {
	public readonly name = 'unblock';

	public readonly data = new ChatInputCommandBuilder()
		.setName('unblock')
		.setDescription('Allow a previously blocked user to open new ModMail tickets again')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addUserOptions((option) =>
			option
				.setName('user')
				.setDescription("User to unblock - defaults to this ticket's user if run inside a ModMail thread")
				.setRequired(false),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, _logger: Logger) {
		if (!interaction.guild_id || !interaction.channel || !interaction.member) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const guildId = interaction.guild_id;
		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);

		const reply = async (content: string) => {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content,
				flags: MessageFlags.Ephemeral,
			});
		};

		const explicitUser = options.getUser('user');
		const thread = await findOpenThreadByModThreadId(interaction.channel.id);
		const targetUserId = explicitUser?.id ?? thread?.userId;

		if (!targetUserId) {
			await reply('Specify a user, or run this inside an open ModMail ticket thread.');
			return;
		}

		const [unblocked] = await getContext().db<[{ userId: string }?]>`
			DELETE FROM blocks WHERE user_id = ${targetUserId} AND guild_id = ${guildId} RETURNING user_id
		`;

		if (unblocked) {
			await reply(`✅ <@${targetUserId}> can open new ModMail tickets again.`);
		} else {
			await reply(`<@${targetUserId}> isn't currently blocked.`);
		}
	}
}
