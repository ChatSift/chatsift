import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
	APIApplicationCommandAutocompleteInteraction,
	APIApplicationCommandInteraction,
	APIApplicationCommandInteractionDataIntegerOption,
	APIApplicationCommandInteractionDataNumberOption,
	APIApplicationCommandInteractionDataStringOption,
	APIInteraction,
	APIMessageComponentInteraction,
	APIModalSubmitInteraction,
	RESTPostAPIApplicationCommandsJSONBody,
} from '@discordjs/core';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';

export interface ResolvedCommandIdentifier {
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
export type ApplicationCommandHandler<TReturnType = any> = (
	interaction: APIApplicationCommandInteraction,
	options: InteractionOptionResolver,
) => TReturnType;

/**
 * Callback responsible for handling components.
 */
export type ComponentHandler<TReturnType = any> = (
	interaction: APIMessageComponentInteraction,
	args: string[],
) => TReturnType;

// [command]:argName
export type AutocompleteIdentifier = `${ApplicationCommandIdentifier}:${string}`;

/**
 * Callback responsible for handling autocompletes.
 */
export type AutocompleteHandler<TReturnType = any> = (
	interaction: APIApplicationCommandAutocompleteInteraction,
	option:
		| APIApplicationCommandInteractionDataIntegerOption
		| APIApplicationCommandInteractionDataNumberOption
		| APIApplicationCommandInteractionDataStringOption,
) => TReturnType;

/**
 * Callback responsible for handling modals.
 */
export type ModalHandler<TReturnType = any> = (interaction: APIModalSubmitInteraction, args: string[]) => TReturnType;

export interface HandlerModule<TReturnType> {
	register(handler: ICommandHandler<TReturnType>): void;
}

export type HandlerModuleConstructor<TReturnType> = new (...args: unknown[]) => HandlerModule<TReturnType>;

export const USEFUL_HANDLERS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'handlers');

export interface RegisterOptions<TReturnType = any> {
	applicationCommands?: [ApplicationCommandIdentifier, ApplicationCommandHandler<TReturnType>][];
	autocomplete?: [AutocompleteIdentifier, AutocompleteHandler<TReturnType>][];
	components?: [string, ComponentHandler<TReturnType>][];
	interactions?: RESTPostAPIApplicationCommandsJSONBody[];
	modals?: [string, ModalHandler<TReturnType>][];
}

export abstract class ICommandHandler<TReturnType> {
	public abstract handle(interaction: APIInteraction): Promise<void>;
	public abstract register(options: RegisterOptions<TReturnType>): void;
	public abstract deployCommands(): Promise<void>;
}
