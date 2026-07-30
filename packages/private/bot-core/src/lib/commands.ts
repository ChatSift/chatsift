import { glob } from 'node:fs/promises';
import type { Logger } from '@chatsift/backend-core';
import { getContext, isModuleWithDefault } from '@chatsift/backend-core';
import type {
	APIApplicationCommandAutocompleteInteraction,
	APIApplicationCommandInteraction,
	RESTPostAPIChatInputApplicationCommandsJSONBody,
	RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { resolveForeignOwnerLabel } from './ownership.js';

/**
 * Deliberately excludes `RESTPostAPIPrimaryEntryPointApplicationCommandJSONBody` (the "Activity" entry-point
 * command type) — it's global-only and not something any current bot needs, and excluding it lets `data` flow
 * straight into both `bulkOverwriteGuildCommands` and `bulkOverwriteGlobalCommands` without a cast.
 */
export type CommandData =
	RESTPostAPIChatInputApplicationCommandsJSONBody | RESTPostAPIContextMenuApplicationCommandsJSONBody;

export interface CommandHandler {
	readonly data: CommandData;
	handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void>;
	handleAutocomplete?(interaction: APIApplicationCommandAutocompleteInteraction, logger: Logger): Promise<void>;
	readonly name: string;
}

type CommandHandlerConstructor = new () => CommandHandler;

function isCommandHandlerConstructor(input: unknown): input is CommandHandlerConstructor {
	return typeof input === 'function' && input.length === 0 && 'handle' in input.prototype;
}

const commands = new Map<string, CommandHandler>();

export function registerCommandHandler(handler: CommandHandler): void {
	commands.set(handler.name, handler);
	getContext().logger.info({ command: handler.name }, 'Registered command handler');
}

/**
 * Returns `true` if it fully handled the interaction (including replying to it), `false` to fall
 * through to the usual "no handler found" error reply.
 */
export type UnknownCommandResolver = (
	interaction: APIApplicationCommandInteraction,
	logger: Logger,
) => Promise<boolean>;

let unknownCommandResolver: UnknownCommandResolver | undefined;

/**
 * Escape hatch for commands that can't be statically registered via `registerCommandHandlers` because
 * they're created per-guild at runtime (e.g. services/modmail-bot's snippets, each their own guild
 * slash command minted by the API — see `services/api/src/routes/modmail/snippets/createSnippet.ts`).
 * `handleCommandInteraction` calls this only when the static `commands` map has no match for the
 * interaction's command name, so it never shadows a real static command handler. At most one resolver
 * is supported (no service currently needs more than one dynamic-command source).
 */
export function registerUnknownCommandResolver(resolver: UnknownCommandResolver): void {
	unknownCommandResolver = resolver;
}

/**
 * Globs `${commandsDir}/**\/*.js`, dynamically imports each module, and registers every valid default-exported
 * `CommandHandler` constructor. Callers pass their own service-local commands directory (e.g.
 * `join(dirname(fileURLToPath(import.meta.url)), 'commands')`), since this package has no `commands/` of its own.
 */
export async function registerCommandHandlers(commandsDir: string): Promise<void> {
	const files = glob(`${commandsDir}/**/*.js`);

	for await (const file of files) {
		const mod = await import(file);
		if (!isModuleWithDefault(mod, isCommandHandlerConstructor)) {
			getContext().logger.warn({ file }, 'Skipped invalid command handler module');
			continue;
		}

		registerCommandHandler(new mod.default());
	}
}

export function getCommandHandler(name: string): CommandHandler | undefined {
	return commands.get(name);
}

/**
 * All commands are global (no per-guild registration) — this is every registered handler's `data`, including
 * `deploy` itself, since `bulkOverwriteGlobalCommands` replaces the entire global command set and omitting it
 * here would delete `/deploy` on its own next run.
 */
export function getAllCommandsData(): CommandData[] {
	return [...commands.values()].map((handler) => handler.data);
}

export async function handleCommandInteraction(
	interaction: APIApplicationCommandInteraction,
	logger: Logger,
): Promise<void> {
	// Component/slash-command interactions are Discord-application-scoped already (a leftover command
	// only ever dispatches to the application that registered it), so this is defense-in-depth rather
	// than the actual doubling-risk boundary -- see docs/roadmap/01-architecture.md §8. It
	// mainly matters right after an instance swap, where stale `/snippet` commands under the old
	// application would otherwise act on a guild this deployment no longer owns.
	const foreignOwnerLabel = resolveForeignOwnerLabel(interaction.guild_id);
	if (foreignOwnerLabel) {
		logger.warn(
			{ guildId: interaction.guild_id, commandName: interaction.data.name, foreignOwnerLabel },
			'Blocked a command interaction for a guild owned by a different deployment',
		);
		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: `This server is served by ${foreignOwnerLabel}. Please use its commands instead.`,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const handler = commands.get(interaction.data.name);
	if (!handler) {
		if (unknownCommandResolver && (await unknownCommandResolver(interaction, logger))) {
			return;
		}

		logger.warn({ commandName: interaction.data.name }, 'No handler found for command interaction');
		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: 'Something went wrong resolving this command. Please let a developer know.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	await handler.handle(interaction, logger);
}

export async function handleAutocompleteInteraction(
	interaction: APIApplicationCommandAutocompleteInteraction,
	logger: Logger,
): Promise<void> {
	// No user-facing reply here (unlike the command/component handlers) -- an autocomplete response
	// can only be a choice list, not a message, so there's nothing meaningful to say. The point is
	// just to not run a foreign guild's autocomplete query at all; Discord shows no results either way.
	const foreignOwnerLabel = resolveForeignOwnerLabel(interaction.guild_id);
	if (foreignOwnerLabel) {
		logger.warn(
			{ guildId: interaction.guild_id, commandName: interaction.data.name, foreignOwnerLabel },
			'Blocked an autocomplete interaction for a guild owned by a different deployment',
		);
		return;
	}

	const handler = commands.get(interaction.data.name);
	if (!handler?.handleAutocomplete) {
		logger.warn({ commandName: interaction.data.name }, 'No autocomplete handler found for command interaction');
		return;
	}

	await handler.handleAutocomplete(interaction, logger);
}
