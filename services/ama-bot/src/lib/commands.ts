import { glob } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContext, isModuleWithDefault } from '@chatsift/backend-core';
import type {
	APIApplicationCommandAutocompleteInteraction,
	APIApplicationCommandInteraction,
	RESTPostAPIChatInputApplicationCommandsJSONBody,
	RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';

/**
 * Deliberately excludes `RESTPostAPIPrimaryEntryPointApplicationCommandJSONBody` (the "Activity" entry-point
 * command type) — it's global-only and not something AMA needs, and excluding it lets `data` flow straight into
 * both `bulkOverwriteGuildCommands` and `bulkOverwriteGlobalCommands` without a cast.
 */
export type CommandData = RESTPostAPIChatInputApplicationCommandsJSONBody | RESTPostAPIContextMenuApplicationCommandsJSONBody;

export interface CommandHandler {
	readonly data: CommandData;
	handle(interaction: APIApplicationCommandInteraction): Promise<void>;
	handleAutocomplete?(interaction: APIApplicationCommandAutocompleteInteraction): Promise<void>;
	readonly name: string;
}

type CommandHandlerConstructor = new () => CommandHandler;

function isCommandHandlerConstructor(input: unknown): input is CommandHandlerConstructor {
	return typeof input === 'function' && input.length === 0 && 'handle' in input.prototype;
}

const commands = new Map<string, CommandHandler>();

export async function registerCommandHandlers(): Promise<void> {
	const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands');
	const files = glob(`${path}/**/*.js`);

	for await (const file of files) {
		const mod = await import(file);
		if (!isModuleWithDefault(mod, isCommandHandlerConstructor)) {
			getContext().logger.warn({ file }, 'Skipped invalid command handler module');
			continue;
		}

		const handler = new mod.default();
		commands.set(handler.name, handler);
		getContext().logger.info({ command: handler.name }, 'Registered command handler');
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

export async function handleCommandInteraction(interaction: APIApplicationCommandInteraction): Promise<void> {
	const handler = commands.get(interaction.data.name);
	if (!handler) {
		getContext().logger.warn({ commandName: interaction.data.name }, 'No handler found for command interaction');
		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: 'Something went wrong resolving this command. Please let a developer know.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	await handler.handle(interaction);
}

export async function handleAutocompleteInteraction(
	interaction: APIApplicationCommandAutocompleteInteraction,
): Promise<void> {
	const handler = commands.get(interaction.data.name);
	if (!handler?.handleAutocomplete) {
		getContext().logger.warn(
			{ commandName: interaction.data.name },
			'No autocomplete handler found for command interaction',
		);
		return;
	}

	await handler.handleAutocomplete(interaction);
}
