import type { PermissionsResolvable } from '@automoderator/core';
import type { Awaitable } from '@discordjs/util';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';
import type {
	ApplicationCommandType,
	APIChatInputApplicationCommandGuildInteraction,
	APIUserApplicationCommandGuildInteraction,
	APIMessageApplicationCommandGuildInteraction,
	RESTPostAPIApplicationCommandsJSONBody,
	APIApplicationCommandAutocompleteGuildInteraction,
	APIApplicationCommandOptionChoice,
	APIApplicationCommandSubcommandOption,
} from 'discord-api-types/v10';

interface InteractionTypeMapping {
	[ApplicationCommandType.ChatInput]: APIChatInputApplicationCommandGuildInteraction;
	[ApplicationCommandType.User]: APIUserApplicationCommandGuildInteraction;
	[ApplicationCommandType.Message]: APIMessageApplicationCommandGuildInteraction;
}

export type CommandBody<Type extends ApplicationCommandType> = RESTPostAPIApplicationCommandsJSONBody & {
	type: Type;
};

export interface Command<Type extends ApplicationCommandType = ApplicationCommandType> {
	readonly containsSubcommands?: false;
	handle(interaction: InteractionTypeMapping[Type], options: InteractionOptionResolver): Awaitable<unknown>;
	handleAutocomplete?(
		interaction: APIApplicationCommandAutocompleteGuildInteraction,
	): Awaitable<APIApplicationCommandOptionChoice[]>;
	readonly interactionOptions: CommandBody<Type>;
	readonly requiredClientPermissions?: PermissionsResolvable;
}

export interface CommandWithSubcommands {
	readonly containsSubcommands: true;
	handleAutocomplete?(
		interaction: APIApplicationCommandAutocompleteGuildInteraction,
		options: InteractionOptionResolver,
	): Awaitable<APIApplicationCommandOptionChoice[]>;
	readonly interactionOptions: Omit<CommandBody<ApplicationCommandType.ChatInput>, 'options' | 'type'>;
	readonly requiredClientPermissions?: PermissionsResolvable;
}

export type Subcommand = Omit<
	Command<ApplicationCommandType.ChatInput>,
	'containsSubcommands' | 'interactionOptions'
> & {
	readonly interactionOptions: Omit<APIApplicationCommandSubcommandOption, 'type'>;
};

export type CommandConstructor = new (...args: any[]) => Command | CommandWithSubcommands | Subcommand;
