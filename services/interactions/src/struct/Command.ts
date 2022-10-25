import type { Awaitable, CommandInteractionOptionResolver, PermissionsResolvable } from '@automoderator/common';
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

type InteractionTypeMapping = {
	[ApplicationCommandType.ChatInput]: APIChatInputApplicationCommandGuildInteraction;
	[ApplicationCommandType.User]: APIUserApplicationCommandGuildInteraction;
	[ApplicationCommandType.Message]: APIMessageApplicationCommandGuildInteraction;
};

export type CommandBody<Type extends ApplicationCommandType> = RESTPostAPIApplicationCommandsJSONBody & {
	type: Type;
};

export type Command<Type extends ApplicationCommandType = ApplicationCommandType> = {
	readonly containsSubcommands?: false;
	handle(interaction: InteractionTypeMapping[Type], options: CommandInteractionOptionResolver): Awaitable<unknown>;
	handleAutocomplete?(
		interaction: APIApplicationCommandAutocompleteGuildInteraction,
	): Awaitable<APIApplicationCommandOptionChoice[]>;
	readonly interactionOptions: CommandBody<Type>;
	readonly requiredClientPermissions?: PermissionsResolvable;
};

export type CommandWithSubcommands = {
	readonly containsSubcommands: true;
	handleAutocomplete?(
		interaction: APIApplicationCommandAutocompleteGuildInteraction,
		options: CommandInteractionOptionResolver,
	): Awaitable<APIApplicationCommandOptionChoice[]>;
	readonly interactionOptions: Omit<CommandBody<ApplicationCommandType.ChatInput>, 'options' | 'type'>;
	readonly requiredClientPermissions?: PermissionsResolvable;
};

export type Subcommand = Omit<
	Command<ApplicationCommandType.ChatInput>,
	'containsSubcommands' | 'interactionOptions'
> & {
	readonly interactionOptions: Omit<APIApplicationCommandSubcommandOption, 'type'>;
};

export type CommandConstructor = new (...args: any[]) => Command | CommandWithSubcommands | Subcommand;
