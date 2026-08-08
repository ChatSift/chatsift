import type { Logger } from '@chatsift/backend-core';
import { createDashboardLinkToken, getContext, revokeDashboardSessionsFor } from '@chatsift/backend-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import type { CommandHandler } from './commands.js';

/**
 * `/dashboard` -- registered on every bot by `createBotClient` (see `client.ts`), the same way `/deploy` is.
 * Replaces the old per-capability grant-token link commands (AMA's `create` subcommand, ModMail's `config`,
 * `snippet create`, and `block-list`): instead of minting a link scoped to one action in one bot, `open` mints
 * a link that exchanges (`GET /v3/auth/dashboard`, `services/api`) for a full guild-scoped session -- the same
 * authority a logged-in manager has, just limited to this one guild and a 30-minute window, and usable across
 * every bot installed there, not just the one the command ran on. See docs/roadmap/01-architecture.md for the
 * full design.
 */
export default class DashboardCommand implements CommandHandler {
	public readonly name = 'dashboard';

	public readonly data = new ChatInputCommandBuilder()
		.setName('dashboard')
		.setDescription('Get a temporary link to manage this server from the dashboard')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addSubcommands(
			(subcommand) =>
				subcommand.setName('open').setDescription('Get a one-time link to open the dashboard for this server'),
			(subcommand) =>
				subcommand
					.setName('revoke')
					.setDescription('Immediately end any active dashboard sessions opened via a /dashboard link'),
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

		const user = interaction.member?.user ?? interaction.user;
		if (!user) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'Could not determine who ran this command.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const subcommand = options.getSubcommand(true);

		switch (subcommand) {
			case 'open': {
				await this.handleOpen(interaction, user.id);
				break;
			}

			case 'revoke': {
				await this.handleRevoke(interaction, user.id);
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
	 * The link points at the API's exchange route directly, not the dashboard -- the browser lands on a clean
	 * `/dashboard/<guildId>` URL only after the API has already turned this single-use token into a session
	 * cookie, so the token itself is never visible in the dashboard's URL bar or browser history the way the
	 * old grant tokens were (`?token=` stayed on the page for the whole visit).
	 */
	private async handleOpen(interaction: APIApplicationCommandInteraction, sub: string): Promise<void> {
		const token = createDashboardLinkToken({ sub, guildId: interaction.guild_id! });
		const url = `${getContext().API_URL}/v3/auth/dashboard?token=${token}`;

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: [
				'Click to open the dashboard for this server (expires in 2 minutes, single use):',
				`||${url}||`,
				'',
				'**Do not share this link with anyone else** — they will be able to act on your behalf on the ' +
					'dashboard for the next 30 minutes, and you will have no way to stop them without reaching out to ' +
					'the developers (or running `/dashboard revoke`, which immediately ends every session this command ' +
					'has opened for this server).',
				'',
				"If you're already logged into the dashboard normally in this browser, opening this link will sign " +
					"you out of that session — there's no reason to use it while already logged in.",
			].join('\n'),
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleRevoke(interaction: APIApplicationCommandInteraction, sub: string): Promise<void> {
		await revokeDashboardSessionsFor(sub, interaction.guild_id!);

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: 'Any active dashboard sessions opened via a `/dashboard` link for this server have been ended.',
			flags: MessageFlags.Ephemeral,
		});
	}
}
