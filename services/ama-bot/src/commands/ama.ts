import type { Logger } from '@chatsift/backend-core';
import { createGrantToken, getContext, GRANTS } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import type { AmaSessions } from '@chatsift/db';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import {
	ApplicationIntegrationType,
	ComponentType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
} from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';

type SelectKind = 'end' | 'repost-prompt';

const SELECT_CUSTOM_ID: Record<SelectKind, string> = {
	end: 'ama-end-select',
	'repost-prompt': 'ama-repost-select',
};

const SELECT_PLACEHOLDER: Record<SelectKind, string> = {
	end: 'Select an AMA to end',
	'repost-prompt': 'Select an AMA to repost the prompt for',
};

const SELECT_PROMPT: Record<SelectKind, string> = {
	end: 'Choose which AMA to end:',
	'repost-prompt': 'Choose which AMA to repost the prompt for:',
};

export default class AmaCommand implements CommandHandler {
	public readonly name = 'ama';

	public readonly data = new ChatInputCommandBuilder()
		.setName('ama')
		.setDescription('Manage Ask-Me-Anything sessions in this server')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addSubcommands(
			(subcommand) =>
				subcommand.setName('create').setDescription('Get a one-time link to create a new AMA from the dashboard'),
			(subcommand) => subcommand.setName('end').setDescription("End one of this server's ongoing AMAs"),
			(subcommand) =>
				subcommand.setName('repost-prompt').setDescription('Repost an AMA prompt message that was deleted'),
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

			case 'end': {
				await this.handleSelect(interaction, 'end');
				break;
			}

			case 'repost-prompt': {
				await this.handleSelect(interaction, 'repost-prompt');
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
	 * Deliberately does not create an AMA itself - creation needs the full config form (channels, upload limits,
	 * prompt mode) that only the dashboard exposes. Instead this mints a short-lived, single-use grant token
	 * scoped to `ama:create` in this guild for the runner, and points at the same dashboard create page a
	 * logged-in manager would use — it accepts the grant token in place of a full OAuth login (see `isAuthed`'s
	 * `grants` option), so there's no separate page to keep in sync.
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
			grant: GRANTS.AMA_CREATE,
		});
		const url = `${getContext().FRONTEND_URL}/dashboard/${interaction.guild_id}/ama/amas/new?token=${token}`;

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: `Click to create a new AMA (link expires soon, single use): ${url}`,
			flags: MessageFlags.Ephemeral,
		});
	}

	/**
	 * Shared by `end` and `repost-prompt`: both act on one of the guild's ongoing AMAs, picked via a select menu
	 * instead of a raw ID option. The actual action runs from the resulting `ama-end-select`/`ama-repost-select`
	 * component handler once the user picks an option.
	 */
	private async handleSelect(interaction: APIApplicationCommandInteraction, kind: SelectKind) {
		const sessions = await getContext().db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${interaction.guild_id!} AND ended = false ORDER BY id DESC LIMIT 25
		`;

		if (!sessions.length) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'There are no ongoing AMAs in this server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: SELECT_PROMPT[kind],
			flags: MessageFlags.Ephemeral,
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							type: ComponentType.StringSelect,
							custom_id: SELECT_CUSTOM_ID[kind],
							placeholder: SELECT_PLACEHOLDER[kind],
							options: sessions.map((session) => ({
								label: session.title.slice(0, 100),
								value: String(session.id),
							})),
						},
					],
				},
			],
		});
	}
}
