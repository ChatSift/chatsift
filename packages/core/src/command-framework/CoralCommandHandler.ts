import {
	API,
	InteractionType,
	type APIApplicationCommandAutocompleteInteraction,
	type APIApplicationCommandInteraction,
	type APIInteraction,
	type RESTPostAPIApplicationCommandsJSONBody,
} from '@discordjs/core';
import { InteractionOptionResolver } from '@sapphire/discord-utilities';
import {
	type InteractionHandler as CoralInteractionHandler,
	Actions,
	Actions as CoralActions,
	Executor as CoralExecutor,
	ExecutorEvents,
} from 'coral-command';
import { inject, injectable } from 'inversify';
import type { Selectable } from 'kysely';
import { type Logger } from 'pino';
import type { IDataManager } from '../application-data/IDataManager.js';
import { INJECTION_TOKENS } from '../container.js';
import type { Incident } from '../db.js';
import type { Env } from '../util/Env.js';
import {
	ICommandHandler,
	type ApplicationCommandHandler,
	type ApplicationCommandIdentifier,
	type AutocompleteHandler,
	type AutocompleteIdentifier,
	type ComponentHandler,
	type ModalHandler,
	type RegisterOptions,
	type ResolvedCommandIdentifier,
} from './ICommandHandler.js';

@injectable()
export class CoralCommandHandler extends ICommandHandler<CoralInteractionHandler> {
	readonly #interactions: RESTPostAPIApplicationCommandsJSONBody[] = [];

	readonly #handlers = {
		applicationCommands: new Map<ApplicationCommandIdentifier, ApplicationCommandHandler<CoralInteractionHandler>>(),
		components: new Map<string, ComponentHandler<CoralInteractionHandler>>(),
		autocomplete: new Map<AutocompleteIdentifier, AutocompleteHandler<CoralInteractionHandler>>(),
		modals: new Map<string, ModalHandler<CoralInteractionHandler>>(),
	} as const;

	readonly #executor: CoralExecutor;

	public constructor(
		private readonly api: API,
		private readonly database: IDataManager,
		private readonly env: Env,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
	) {
		super();

		this.#executor = new CoralExecutor(api, env.discordClientId)
			.on(ExecutorEvents.CallbackError, (error) => this.logger.error(error, 'Unhandled error in command executor'))
			.on(ExecutorEvents.HandlerError, async (error, actions) => {
				this.logger.error(error, 'Unhandled error in command handler');

				const incident =
					error instanceof Error
						? await this.database.createIncident(error, actions.interaction.guild_id)
						: await this.database.createIncident(
								new Error("Handler threw non-error. We don't have a stack."),
								actions.interaction.guild_id,
							);

				return this.reportIncident(actions, incident);
			});
	}

	public async deployCommands(): Promise<void> {
		await this.api.applicationCommands.bulkOverwriteGlobalCommands(this.env.discordClientId, this.#interactions);
	}

	public async handle(interaction: APIInteraction): Promise<void> {
		switch (interaction.type) {
			case InteractionType.Ping: {
				this.logger.warn('Received a ping interaction. This CommandHandler is designed for Gateway.');
				break;
			}

			case InteractionType.ApplicationCommand: {
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
				await this.reportIncident(this.interactionToActions(interaction), incident);

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
				await this.reportIncident(this.interactionToActions(interaction), incident);

				break;
			}

			case InteractionType.ApplicationCommandAutocomplete: {
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
				await this.reportIncident(this.interactionToActions(interaction), incident);

				break;
			}

			case InteractionType.ModalSubmit: {
				const [identifier, ...args] = interaction.data.custom_id.split(':') as [string, ...string[]];
				const handler = this.#handlers.modals.get(identifier);

				if (handler) {
					return this.wrapHandler(handler)(interaction, args);
				}

				const incident = await this.database.createIncident(new Error('Modal handler not found'), interaction.guild_id);
				await this.reportIncident(this.interactionToActions(interaction), incident);

				break;
			}
		}
	}

	public override register(options: RegisterOptions): void {
		if (options.interactions) {
			this.#interactions.push(...options.interactions);
		}

		if (options.applicationCommands?.length) {
			for (const [identifier, handler] of options.applicationCommands) {
				this.#handlers.applicationCommands.set(identifier, handler);
			}
		}

		if (options.components?.length) {
			for (const [name, handler] of options.components) {
				this.#handlers.components.set(name, handler);
			}
		}

		if (options.autocomplete?.length) {
			for (const [identifier, handler] of options.autocomplete) {
				this.#handlers.autocomplete.set(identifier, handler);
			}
		}

		if (options.modals?.length) {
			for (const [name, handler] of options.modals) {
				this.#handlers.modals.set(name, handler);
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

	// TODO: Handle specific errors maybe
	private async reportIncident(actions: CoralActions, incident: Selectable<Incident>): Promise<void> {
		await actions.respond({
			content: `An error occurred while processing your request. Please report this incident to the developers. (Incident ID: ${incident.id})`,
		});
	}

	private interactionToActions(interaction: APIInteraction): Actions {
		return new Actions(this.api, this.env.discordClientId, interaction);
	}

	private wrapHandler<HandlerArgs extends [APIInteraction, ...any[]]>(
		handler: (...args: HandlerArgs) => CoralInteractionHandler,
	): (...args: HandlerArgs) => Promise<void> {
		return async (...args) => {
			const [interaction] = args;

			const generator = handler(...args);
			await this.#executor.handleInteraction(generator, interaction);
		};
	}
}
