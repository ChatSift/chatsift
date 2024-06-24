import {
	API,
	InteractionType,
	type APIApplicationCommandAutocompleteInteraction,
	type APIApplicationCommandInteraction,
	type APIApplicationCommandInteractionDataIntegerOption,
	type APIApplicationCommandInteractionDataNumberOption,
	type APIApplicationCommandInteractionDataStringOption,
	type APIInteraction,
	type APIMessageComponentInteraction,
	type APIModalSubmitInteraction,
} from '@discordjs/core';
import { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { inject, injectable } from 'inversify';
import type { Selectable } from 'kysely';
import type { Logger } from 'pino';
import type { IDataManager } from '../applicationData/IDataManager.js';
import { INJECTION_TOKENS } from '../container.js';
import type { Incident } from '../db.js';
import { ICommandHandler } from './ICommandHandler.js';

/**
 * @internal
 */
interface ResolvedCommandIdentifier {
	root: ApplicationCommandIdentifier;
	subcommand?: ApplicationCommandIdentifier;
}

/**
 * The identifier of a command.
 * `name:group:subcommand`
 */
export type ApplicationCommandIdentifier = `${string}:${string}:${string}`;

/**
 * Callback responsible for handling application commands.
 */
export type ApplicationCommandHandler = (
	interaction: APIApplicationCommandInteraction,
	options: InteractionOptionResolver,
) => Promise<void>;

/**
 * Callback responsible for handling components.
 */
export type ComponentHandler = (interaction: APIMessageComponentInteraction, args: string[]) => Promise<void>;

// [command]:argName
export type AutocompleteIdentifier = `${ApplicationCommandIdentifier}:${string}`;

/**
 * Callback responsible for handling autocompletes.
 */
export type AutocompleteHandler = (
	interaction: APIApplicationCommandAutocompleteInteraction,
	option:
		| APIApplicationCommandInteractionDataIntegerOption
		| APIApplicationCommandInteractionDataNumberOption
		| APIApplicationCommandInteractionDataStringOption,
) => Promise<void>;

/**
 * Callback responsible for handling modals.
 */
export type ModalHandler = (interaction: APIModalSubmitInteraction, args: string[]) => Promise<void>;

@injectable()
export class CommandHandler extends ICommandHandler {
	readonly #handlers = {
		applicationCommands: new Map<ApplicationCommandIdentifier, ApplicationCommandHandler>(),
		components: new Map<string, ComponentHandler>(),
		autocomplete: new Map<AutocompleteIdentifier, AutocompleteHandler>(),
		modals: new Map<string, ModalHandler>(),
	} as const;

	public constructor(
		private readonly api: API,
		private readonly database: IDataManager,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
	) {
		super();
	}

	public async handle(interaction: APIInteraction): Promise<void> {
		if (!interaction.guild_id) {
			const incident = await this.database.createIncident(new Error('Interaction not in guild'));
			return this.reportIncident(interaction, incident);
		}

		switch (interaction.type) {
			case InteractionType.Ping: {
				this.logger.warn('Received a ping interaction. We should not receive these, as we run WS.');
				break;
			}

			case InteractionType.ApplicationCommand: {
				// @ts-expect-error - discord api types version miss match
				const options = new InteractionOptionResolver(interaction);

				const { root, subcommand } = this.resolveCommandIdentifier(interaction, options);
				if (subcommand) {
					const subcommandHandler = this.#handlers.applicationCommands.get(subcommand);
					if (subcommandHandler) {
						return this.wrapHandler(subcommandHandler)(interaction, options);
					}
				}

				const rootHandler = this.#handlers.applicationCommands.get(root);
				if (rootHandler) {
					return this.wrapHandler(rootHandler)(interaction, options);
				}

				const incident = await this.database.createIncident(
					new Error('Command handler not found'),
					interaction.guild_id,
				);
				await this.reportIncident(interaction, incident);

				break;
			}

			case InteractionType.MessageComponent: {
				const [identifier, ...args] = interaction.data.custom_id.split(':') as [string, ...string[]];

				const handler = this.#handlers.components.get(identifier);
				if (handler) {
					return this.wrapHandler(handler)(interaction, args);
				}

				const incident = await this.database.createIncident(
					new Error('Component handler not found'),
					interaction.guild_id,
				);
				await this.reportIncident(interaction, incident);

				break;
			}

			case InteractionType.ApplicationCommandAutocomplete: {
				// @ts-expect-error - discord api types version miss match
				const options = new InteractionOptionResolver(interaction);

				const { root, subcommand } = this.resolveCommandIdentifier(interaction, options);
				const focused = options.getFocusedOption();

				if (subcommand) {
					const subcommandHandler = this.#handlers.autocomplete.get(`${subcommand}:${focused.name}`);
					if (subcommandHandler) {
						return this.wrapHandler(subcommandHandler)(interaction, focused);
					}
				}

				const rootHandler = this.#handlers.autocomplete.get(`${root}:${focused.name}`);
				if (rootHandler) {
					return this.wrapHandler(rootHandler)(interaction, focused);
				}

				const incident = await this.database.createIncident(
					new Error('Autocomplete handler not found'),
					interaction.guild_id,
				);
				await this.reportIncident(interaction, incident);

				break;
			}

			case InteractionType.ModalSubmit: {
				const [identifier, ...args] = interaction.data.custom_id.split(':') as [string, ...string[]];
				const handler = this.#handlers.modals.get(identifier);

				if (handler) {
					return this.wrapHandler(handler)(interaction, args);
				}

				const incident = await this.database.createIncident(new Error('Modal handler not found'), interaction.guild_id);
				await this.reportIncident(interaction, incident);

				break;
			}
		}
	}

	/**
	 * Resolves the command identifier from the interaction.
	 *
	 * @returns If we have subcommands, we return a primary (with subcommand, and group if present),
	 * along with a fallback (root command)
	 * If we don't have subcommands, we return only a primary.
	 */
	private resolveCommandIdentifier(
		interaction: APIApplicationCommandAutocompleteInteraction | APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): ResolvedCommandIdentifier {
		const group = options.getSubcommandGroup(false);
		const subcommand = options.getSubcommand(false);

		const identifier: ApplicationCommandIdentifier = `${interaction.data.name}:${group ?? 'none'}:${subcommand ?? 'none'}`;
		if (subcommand) {
			return {
				root: `${interaction.data.name}:none:none`,
				subcommand: identifier,
			};
		}

		return { root: identifier };
	}

	private async reportIncident(interaction: APIInteraction, incident: Selectable<Incident>): Promise<void> {
		await this.api.interactions.reply(interaction.id, interaction.token, {
			content: `An error occurred while processing your request. Please report this incident to the developers. (Incident ID: ${incident.id})`,
		});
	}

	private wrapHandler<HandlerArgs extends [APIInteraction, ...any[]]>(
		handler: (...args: HandlerArgs) => Promise<void>,
	): (...args: HandlerArgs) => Promise<void> {
		return async (...args) => {
			const [interaction] = args;

			try {
				await handler(...args);
			} catch (error) {
				this.logger.error(error, 'Unhandled error in command handler');

				const incident =
					error instanceof Error
						? await this.database.createIncident(error, interaction.guild_id)
						: await this.database.createIncident(
								new Error("Handler threw non-error. We don't have a stack."),
								interaction.guild_id,
							);

				return this.reportIncident(interaction, incident);
			}
		};
	}
}
