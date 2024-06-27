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

export interface RegisterOptions {
	applicationCommands?: [ApplicationCommandIdentifier, ApplicationCommandHandler][];
	autocomplete?: [AutocompleteIdentifier, AutocompleteHandler][];
	components?: [string, ComponentHandler][];
	interactions?: RESTPostAPIApplicationCommandsJSONBody[];
	modals?: [string, ModalHandler][];
}

export abstract class ICommandHandler {
	public abstract handle(interaction: APIInteraction): Promise<void>;
	public abstract register(options: RegisterOptions): void;
	public abstract deployCommands(): Promise<void>;
}
