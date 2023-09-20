import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Env, INJECTION_TOKENS, type DiscordEventsMap, encode, decode, globalContainer } from '@automoderator/core';
import { readdirRecurse } from '@chatsift/readdir';
import { PubSubRedisBroker } from '@discordjs/brokers';
import {
	API,
	GatewayDispatchEvents,
	InteractionType,
	type APIApplicationCommandInteraction,
	type RESTPostAPIApplicationCommandsJSONBody,
	type APIMessageComponentInteraction,
	type APIApplicationCommandAutocompleteInteraction,
	type APIApplicationCommandInteractionDataIntegerOption,
	type APIApplicationCommandInteractionDataNumberOption,
	type APIApplicationCommandInteractionDataStringOption,
	type APIModalSubmitInteraction,
} from '@discordjs/core';
import { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { inject, injectable } from 'inversify';
import { Redis } from 'ioredis';
import { type Logger } from 'pino';

// commandName:subcommandGroup:subcommand
export type CommandIdentifier = `${string}:${string}:${string}`;

export type CommandHandler = (
	interaction: APIApplicationCommandInteraction,
	options: InteractionOptionResolver,
) => Promise<void>;

export type ComponentHandler = (interaction: APIMessageComponentInteraction, args: string[]) => Promise<void>;

// [command]:autocompleteName
export type AutocompleteIdentifier = `${CommandIdentifier}:${string}`;

export type AutocompleteHandler = (
	interaction: APIApplicationCommandAutocompleteInteraction,
	option:
		| APIApplicationCommandInteractionDataIntegerOption
		| APIApplicationCommandInteractionDataNumberOption
		| APIApplicationCommandInteractionDataStringOption,
) => Promise<void>;

export type ModalHandler = (interaction: APIModalSubmitInteraction, args: string[]) => Promise<void>;

export interface RegisterOptions {
	autocomplete?: [AutocompleteIdentifier, AutocompleteHandler][];
	commands?: [CommandIdentifier, CommandHandler][];
	components?: [string, ComponentHandler][];
	interaction?: RESTPostAPIApplicationCommandsJSONBody;
	modals?: [string, ModalHandler][];
}

export interface Handler {
	register(): void;
}

export type HandlerConstructor = new (...args: unknown[]) => Handler;

@injectable()
export class InteractionsService {
	private readonly broker: PubSubRedisBroker<DiscordEventsMap>;

	private readonly interactions: RESTPostAPIApplicationCommandsJSONBody[] = [];

	private readonly handlers = {
		commands: new Map<CommandIdentifier, CommandHandler>(),
		components: new Map<string, ComponentHandler>(),
		autocomplete: new Map<AutocompleteIdentifier, AutocompleteHandler>(),
		modals: new Map<string, ModalHandler>(),
	} as const;

	public constructor(
		private readonly env: Env,
		private readonly api: API,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
		@inject(INJECTION_TOKENS.redis) private readonly redis: Redis,
	) {
		this.broker = new PubSubRedisBroker<DiscordEventsMap>({
			redisClient: this.redis,
			encode,
			decode,
		});

		this.broker.on(GatewayDispatchEvents.InteractionCreate, async ({ data: interaction, ack }) => {
			try {
				if (interaction.type === InteractionType.ApplicationCommand) {
					const options = new InteractionOptionResolver(interaction);

					const [identifier, fallbackIdentifier] = this.getCommandIdentifier(interaction, options);
					const handler = this.handlers.commands.get(identifier);

					if (handler) {
						await handler(interaction, options);
						return;
					}

					// Some commands might have a single handler for all subcommands
					if (fallbackIdentifier) {
						const fallback = this.handlers.commands.get(fallbackIdentifier);
						await fallback?.(interaction, options);
					}

					this.logger.warn(`No handler found for command ${identifier}`);
				} else if (interaction.type === InteractionType.MessageComponent) {
					const [name, ...args] = interaction.data.custom_id.split(':') as [string, ...string[]];
					const handler = this.handlers.components.get(name);

					if (!handler) {
						this.logger.warn(`No handler found for component ${name}`);
					}

					await handler?.(interaction, args);
				} else if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
					const options = new InteractionOptionResolver(interaction);
					const focused = options.getFocusedOption();

					const [identifier, fallbackIdentifier] = this.getCommandIdentifier(interaction, options);
					const handler = this.handlers.autocomplete.get(`${identifier}:${focused.name}`);

					if (handler) {
						await handler(interaction, focused);
						return;
					}

					if (fallbackIdentifier) {
						const fallback = this.handlers.autocomplete.get(`${fallbackIdentifier}:${focused.name}`);
						await fallback?.(interaction, focused);
					}

					this.logger.warn(`No handler found for autocomplete ${identifier}:${focused.name}`);
				} else if (interaction.type === InteractionType.ModalSubmit) {
					const [name, ...args] = interaction.data.custom_id.split(':') as [string, ...string[]];
					const handler = this.handlers.modals.get(name);

					if (!handler) {
						this.logger.warn(`No handler found for modal ${name}`);
					}

					await handler?.(interaction, args);
				}
			} catch (error) {
				// TODO: Figure out ways to respond to the user
				this.logger.error(error);
			} finally {
				await ack();
			}
		});
	}

	public async start(): Promise<void> {
		const handlersPath = join(dirname(fileURLToPath(import.meta.url)), 'handlers');
		for await (const file of readdirRecurse(handlersPath, { fileExtensions: ['js'] })) {
			const { default: HandlerConstructor }: { default: HandlerConstructor } = await import(
				pathToFileURL(file).toString()
			);
			const handler = globalContainer.get<Handler>(HandlerConstructor);
			handler.register();
		}

		await this.broker.subscribe('interactions', [GatewayDispatchEvents.InteractionCreate]);
		this.logger.info('Subscribed to interactions');
	}

	public async deployCommands(): Promise<void> {
		await this.api.applicationCommands.bulkOverwriteGlobalCommands(this.env.discordClientId, this.interactions);
	}

	public register(options: RegisterOptions): void {
		if (options.interaction) {
			this.interactions.push(options.interaction);
		}

		if (options.commands?.length) {
			for (const [identifier, handler] of options.commands) {
				this.handlers.commands.set(identifier, handler);
			}
		}

		if (options.components?.length) {
			for (const [name, handler] of options.components) {
				this.handlers.components.set(name, handler);
			}
		}

		if (options.autocomplete?.length) {
			for (const [identifier, handler] of options.autocomplete) {
				this.handlers.autocomplete.set(identifier, handler);
			}
		}

		if (options.modals?.length) {
			for (const [name, handler] of options.modals) {
				this.handlers.modals.set(name, handler);
			}
		}
	}

	private getCommandIdentifier(
		interaction: APIApplicationCommandAutocompleteInteraction | APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): [primary: CommandIdentifier, fallback?: CommandIdentifier] {
		const group = options.getSubcommandGroup(false);
		const subcommand = options.getSubcommand(false);

		const identifier: CommandIdentifier = `${interaction.data.name}:${group ?? 'none'}:${subcommand ?? 'none'}`;
		if (subcommand) {
			return [identifier, `${interaction.data.name}:none:none`];
		}

		return [identifier];
	}
}
