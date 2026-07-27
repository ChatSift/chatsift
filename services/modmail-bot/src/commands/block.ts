import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import type { Blocks } from '@chatsift/db';
import { parseRelativeTimeSafe } from '@chatsift/parse-relative-time';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { findOpenThreadByModThreadId } from '../lib/threads.js';

export default class BlockCommand implements CommandHandler {
	public readonly name = 'block';

	public readonly data = new ChatInputCommandBuilder()
		.setName('block')
		.setDescription('Block a user from opening new ModMail tickets')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addUserOptions((option) =>
			option
				.setName('user')
				.setDescription("User to block - defaults to this ticket's user if run inside a ModMail thread")
				.setRequired(false),
		)
		.addStringOptions((option) =>
			option
				.setName('duration')
				.setDescription('How long the block lasts, e.g. "7d", "2h30m" - omit for a permanent block')
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

		const duration = options.getString('duration');
		let expiresAt: Date | null = null;

		if (duration) {
			const parsed = parseRelativeTimeSafe(duration);
			if (!parsed.ok) {
				await reply(`Couldn't parse that duration: ${parsed.message}`);
				return;
			}

			expiresAt = new Date(Date.now() + parsed.value);
		}

		await getContext().db<Blocks[]>`
			INSERT INTO blocks (user_id, guild_id, expires_at)
			VALUES (${targetUserId}, ${guildId}, ${expiresAt})
			ON CONFLICT (user_id, guild_id) DO UPDATE SET expires_at = EXCLUDED.expires_at
		`;

		const expiryClause = expiresAt ? `until <t:${Math.floor(expiresAt.getTime() / 1_000)}:f>` : 'with no expiry';

		await reply(
			`✅ <@${targetUserId}> is now blocked from opening new ModMail tickets, ${expiryClause}.\n\n` +
				"They have **not** been notified of this, and any of their existing tickets remain open and unaffected — let them know yourself if that's needed.",
		);
	}
}
