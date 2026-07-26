import type { Logger } from '@chatsift/backend-core';
import { createGrantToken, getContext, GRANTS } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';

export default class ConfigCommand implements CommandHandler {
	public readonly name = 'config';

	public readonly data = new ChatInputCommandBuilder()
		.setName('config')
		.setDescription("Get a one-time link to edit this server's ModMail settings from the dashboard")
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.toJSON();

	/**
	 * Deliberately does not edit settings itself — the guild settings form has too many fields
	 * (mod forum, greeting/farewell messages, alert role, several toggles and numeric limits) for a
	 * modal. Mints a short-lived, single-use grant token scoped to `modmail:config:update` in this
	 * guild for the runner, and points at the same config dashboard page a logged-in manager would
	 * use — it accepts the grant token in place of a full OAuth login (see `isAuthed`'s `grants`
	 * option), so there's no separate page to keep in sync.
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
			grant: GRANTS.MODMAIL_CONFIG_UPDATE,
		});
		const url = `${getContext().FRONTEND_URL}/dashboard/${interaction.guild_id}/modmail/config?token=${token}`;

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: `Click to edit ModMail settings (link expires soon, single use): ${url}`,
			flags: MessageFlags.Ephemeral,
		});
	}
}
