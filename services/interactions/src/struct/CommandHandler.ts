import { dirname, join, sep as pathSep } from 'node:path';
import { setTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PermissionsResolvable } from '@automoderator/common';
import { Env, PermissionsBitField, CommandInteractionOptionResolver } from '@automoderator/common';
import { readdirRecurse } from '@chatsift/readdir';
import { inlineCode } from '@discordjs/builders';
import type { RawFile } from '@discordjs/rest';
import { REST } from '@discordjs/rest';
import type {
	APIApplicationCommandAutocompleteGuildInteraction,
	APIApplicationCommandGuildInteraction,
	APIChatInputApplicationCommandGuildInteraction,
	APIGuildInteraction,
	APIMessageComponentGuildInteraction,
	RESTPatchAPIWebhookWithTokenMessageJSONBody,
	RESTPostAPIInteractionCallbackJSONBody,
	RESTPostAPIInteractionFollowupJSONBody,
} from 'discord-api-types/v10';
import { MessageFlags, Routes, InteractionResponseType } from 'discord-api-types/v10';
import { container, singleton } from 'tsyringe';
import { logger } from '../util/logger';
import type { Command, CommandConstructor, CommandWithSubcommands, Subcommand } from './Command';
import type { Component, ComponentConstructor } from './Component';
import { getComponentInfo } from './Component';

@singleton()
export class CommandHandler {
	private readonly replied = new Set<string>();

	public readonly commands = new Map<string, Command | CommandWithSubcommands | Subcommand>();

	public readonly components = new Map<string, Component>();

	public constructor(private readonly env: Env, private readonly rest: REST) {}

	public async reply(
		interaction: APIGuildInteraction,
		payload: RESTPostAPIInteractionCallbackJSONBody,
		files?: RawFile[],
	) {
		await this.rest.post(Routes.interactionCallback(interaction.id, interaction.token), {
			body: payload,
			files,
		});
		this.replied.add(interaction.token);
		setTimeout(() => this.replied.delete(interaction.token), 6_000).unref();
	}

	public async edit(
		interaction: APIGuildInteraction,
		payload: RESTPatchAPIWebhookWithTokenMessageJSONBody,
		files?: RawFile[],
	) {
		return this.rest.patch(Routes.webhookMessage(this.env.discordClientId, interaction.token, '@original'), {
			body: payload,
			files,
		});
	}

	public async followup(
		interaction: APIGuildInteraction,
		payload: RESTPostAPIInteractionFollowupJSONBody,
		files?: RawFile[],
	) {
		return this.rest.post(Routes.webhook(this.env.discordClientId, interaction.token), {
			body: payload,
			files,
		});
	}

	public async handleAutocomplete(interaction: APIApplicationCommandAutocompleteGuildInteraction) {
		const command = this.commands.get(interaction.data.name);

		if (!command?.handleAutocomplete) {
			return this.reply(interaction, {
				type: InteractionResponseType.ApplicationCommandAutocompleteResult,
				data: { choices: [] },
			});
		}

		try {
			const options = new CommandInteractionOptionResolver(interaction);
			const result = await command.handleAutocomplete(interaction, options);
			await this.reply(interaction, {
				type: InteractionResponseType.ApplicationCommandAutocompleteResult,
				data: { choices: result.slice(0, 25) },
			});
			return;
		} catch (error) {
			logger.error(
				{
					err: error,
					command: interaction.data.name,
				},
				'Error handling autocomplete',
			);
			await this.reply(interaction, {
				type: InteractionResponseType.ApplicationCommandAutocompleteResult,
				data: {
					choices: [
						{
							name: 'Something went wrong fetching auto complete options. Please report this bug.',
							value: 'noop',
						},
					],
				},
			});
		}
	}

	public async handleMessageComponent(interaction: APIMessageComponentGuildInteraction) {
		const [name, ...args] = interaction.data.custom_id.split('|') as [string, ...string[]];
		const component = this.components.get(name);

		try {
			// eslint-disable-next-line @typescript-eslint/return-await
			return await component?.handle(interaction, ...args);
		} catch (error) {
			logger.error(
				{
					err: error,
					component: name,
				},
				'Error handling message component',
			);
			const content = `Something went wrong running the component. Please report this bug.\n\n${inlineCode(
				error as string,
			)}`;

			await this.tryReportError(interaction, content);
		}
	}

	public async handleCommand(interaction: APIApplicationCommandGuildInteraction) {
		const options = new CommandInteractionOptionResolver(interaction);
		const command = this.commands.get(interaction.data.name) as Command | CommandWithSubcommands | undefined;

		if (!command) {
			logger.warn(interaction, 'Received interaction for unknown command');
			return;
		}

		try {
			if (!command.containsSubcommands) {
				if (!command.containsSubcommands && command.requiredClientPermissions) {
					const missingRequiredClientPermissions = this.checkForMissingClientPermissions(
						BigInt(interaction.app_permissions ?? '0'),
						command.requiredClientPermissions,
					);
					if (missingRequiredClientPermissions.length) {
						await this.reply(interaction, {
							data: {
								content: `The bot is missing the following permissions to run this command: ${inlineCode(
									missingRequiredClientPermissions.join(', '),
								)}`,
								flags: MessageFlags.Ephemeral,
							},
							type: InteractionResponseType.ChannelMessageWithSource,
						});
						return;
					}
				}

				await command.handle(interaction, options);
				return;
			}

			const subcommand = this.commands.get(`${interaction.data.name}-${options.getSubcommand()}`) as
				| Subcommand
				| undefined;

			if (!subcommand) {
				logger.warn(interaction, 'Command interaction with subcommands map had no subcommand');
				return;
			}

			if (subcommand.requiredClientPermissions) {
				const missingRequiredClientPermissions = this.checkForMissingClientPermissions(
					BigInt(interaction.app_permissions ?? '0'),
					subcommand.requiredClientPermissions,
				);
				if (missingRequiredClientPermissions.length) {
					await this.reply(interaction, {
						data: {
							content: `The bot is missing the following permissions to run this command: ${inlineCode(
								missingRequiredClientPermissions.join(', '),
							)}`,
							flags: MessageFlags.Ephemeral,
						},
						type: InteractionResponseType.ChannelMessageWithSource,
					});
					return;
				}
			}

			await subcommand.handle(interaction as APIChatInputApplicationCommandGuildInteraction, options);
		} catch (error) {
			logger.error(
				{
					err: error,
					interaction,
				},
				'Error handling command',
			);

			const content = `Something went wrong running the component. Please report this bug.\n\n${inlineCode(
				(error as Error).message,
			)}`;

			await this.tryReportError(interaction, content);
		}
	}

	public async init() {
		return Promise.all([this.registerCommands(), this.registerComponents()]);
	}

	private async tryReportError(interaction: APIGuildInteraction, content: string) {
		if (this.replied.has(interaction.token)) {
			return this.followup(interaction, { content, flags: MessageFlags.Ephemeral });
		}

		try {
			await this.reply(interaction, {
				data: { content },
				type: InteractionResponseType.ChannelMessageWithSource,
			});
			await this.reply(interaction, {
				data: { content },
				type: InteractionResponseType.UpdateMessage,
			});
		} catch {}
	}

	private checkForMissingClientPermissions(
		clientPermissions: PermissionsResolvable,
		requiredClientPermissions: PermissionsResolvable,
	): string[] {
		const missingClientPermissions = PermissionsBitField.difference(requiredClientPermissions, clientPermissions);
		if (missingClientPermissions) {
			return PermissionsBitField.toArray(missingClientPermissions);
		}

		return [];
	}

	private async registerCommands(): Promise<void> {
		const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands');
		const files = readdirRecurse(path, { fileExtensions: ['js'] });

		for await (const file of files) {
			const mod = (await import(pathToFileURL(file).toString())) as { default: CommandConstructor };
			const command = container.resolve(mod.default);

			const directory = dirname(file).split(pathSep).pop()!;
			const isSubcommand = (cmd: Command | CommandWithSubcommands | Subcommand): cmd is Subcommand =>
				!['commands', 'context-menus'].includes(directory) && !file.endsWith('index.js');

			if (isSubcommand(command)) {
				this.commands.set(`${directory}-${command.interactionOptions.name}`, command);
			} else {
				this.commands.set(command.interactionOptions.name, command);
			}
		}
	}

	private async registerComponents(): Promise<void> {
		const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'components');
		const files = readdirRecurse(path, { fileExtensions: ['js'] });

		for await (const file of files) {
			const info = getComponentInfo(file);
			if (!info) {
				continue;
			}

			const mod = (await import(pathToFileURL(file).toString())) as { default: ComponentConstructor };
			const component = container.resolve(mod.default);
			const name = component.name ?? info.name;

			this.components.set(name, component);
		}
	}
}
