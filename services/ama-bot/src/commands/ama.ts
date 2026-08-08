import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
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

type SelectKind = 'close' | 'repost-prompt';

const SELECT_CUSTOM_ID: Record<SelectKind, string> = {
	close: 'ama-close-select',
	'repost-prompt': 'ama-repost-select',
};

const SELECT_PLACEHOLDER: Record<SelectKind, string> = {
	close: 'Select an AMA to close',
	'repost-prompt': 'Select an AMA to repost the prompt for',
};

const SELECT_PROMPT: Record<SelectKind, string> = {
	close: 'Choose which AMA to stop accepting questions on:',
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
				subcommand
					.setName('close')
					.setDescription("Stop accepting new questions on one of this server's AMAs (reversible)"),
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
			case 'close': {
				await this.handleSelect(interaction, 'close');
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
	 * Shared by `close` and `repost-prompt`: both act on one of the guild's AMAs that are still accepting
	 * questions, picked via a select menu instead of a raw ID option. The actual action runs from the resulting
	 * `ama-close-select`/`ama-repost-select` component handler once the user picks an option.
	 */
	private async handleSelect(interaction: APIApplicationCommandInteraction, kind: SelectKind) {
		const sessions = await getContext().db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${interaction.guild_id!} AND ended = false ORDER BY id DESC LIMIT 25
		`;

		if (!sessions.length) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'There are no AMAs accepting questions in this server.',
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
