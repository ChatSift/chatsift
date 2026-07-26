import type { Logger } from '@chatsift/backend-core';
import { createGrantToken, getContext, GRANTS } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';

export default class SnippetCommand implements CommandHandler {
	public readonly name = 'snippet';

	public readonly data = new ChatInputCommandBuilder()
		.setName('snippet')
		.setDescription('Manage ModMail snippets in this server')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addSubcommands((subcommand) =>
			subcommand.setName('create').setDescription('Get a one-time link to create a new snippet from the dashboard'),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, _logger: Logger) {
		if (!interaction.guild_id) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const subcommand = options.getSubcommand(true);

		switch (subcommand) {
			case 'create': {
				await this.handleCreate(interaction);
				break;
			}

			default: {
				await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
					content: 'Unknown subcommand.',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	}

	/**
	 * Deliberately does not create a snippet itself — creation needs the dashboard form (live
	 * slash-command-name normalization, attachment fields) rather than a modal. Mints a short-lived,
	 * single-use grant token scoped to `modmail:snippet:create` in this guild for the runner, and points
	 * at the same snippets dashboard page a logged-in manager would use — it accepts the grant token in
	 * place of a full OAuth login (see `isAuthed`'s `grants` option), so there's no separate page to keep
	 * in sync. Existing snippets stay visible on that page under a grant; only their edit/delete controls
	 * are hidden, since the grant only ever authorizes creating one snippet.
	 */
	private async handleCreate(interaction: APIApplicationCommandInteraction) {
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
			guildId: interaction.guild_id!,
			grant: GRANTS.MODMAIL_SNIPPET_CREATE,
		});
		const url = `${getContext().FRONTEND_URL}/dashboard/${interaction.guild_id}/modmail/snippets?token=${token}`;

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: `Click to create a new snippet (link expires soon, single use): ${url}`,
			flags: MessageFlags.Ephemeral,
		});
	}
}
