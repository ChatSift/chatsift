import type { Logger } from '@chatsift/backend-core';
import { createGrantToken, getContext, GRANTS } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';

export default class BlockListCommand implements CommandHandler {
	public readonly name = 'block-list';

	public readonly data = new ChatInputCommandBuilder()
		.setName('block-list')
		.setDescription("Get a link to view this server's blocked ModMail users from the dashboard")
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.toJSON();

	/**
	 * Unlike `/config` and `/snippet create`'s grant links, this one is never claimed (see `listBlocks.ts`'s
	 * `isAuthed` call, which sets `grants` but not `claimsGrant`) — it only ever authorizes reading the
	 * blocks list, never a write, so there's no single action to burn the link on. The dashboard page hides
	 * the unblock controls while viewed under this grant (see `BlockCard.tsx`), making it a genuinely
	 * read-only view rather than a one-shot action link.
	 */
	public async handle(interaction: APIApplicationCommandInteraction, _logger: Logger) {
		if (!interaction.guild_id) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const user = interaction.member?.user ?? interaction.user;
		if (!user) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'Could not determine who ran this command.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const token = createGrantToken({
			sub: user.id,
			guildId: interaction.guild_id,
			grant: GRANTS.MODMAIL_BLOCKS_READ,
		});
		const url = `${getContext().FRONTEND_URL}/dashboard/${interaction.guild_id}/modmail/blocks?token=${token}`;

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: `Click to view blocked ModMail users (read-only, link expires in 15 minutes but can be reloaded): ${url}`,
			flags: MessageFlags.Ephemeral,
		});
	}
}
