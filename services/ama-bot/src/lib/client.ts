import { setInterval } from 'node:timers';
import { getContext, GuildList } from '@chatsift/backend-core';
import type { Snowflake } from '@discordjs/core';
import { InteractionType, Client, GatewayDispatchEvents } from '@discordjs/core';
import { getCommandHandler, handleAutocompleteInteraction, handleCommandInteraction } from './commands.js';
import { handleComponentInteraction } from './components.js';
import { gateway } from './gateway.js';
import { rest } from './rest.js';

declare module '@chatsift/backend-core' {
	interface ContextService {
		/**
		 * The full discord.js `Client`, so anything holding a `Context` can reach Discord without a direct import of
		 * this file (which would risk circular imports for modules the client construction depends on, like
		 * `lib/commands.ts`).
		 */
		client: Client;
	}
}

// keep a copy of the guild ids we manage here to easily patch redis
const guildIds = new Set<Snowflake>();

export function startGuildSyncing(): void {
	setInterval(async () => {
		void GuildList.set('AMA', { guilds: [...guildIds] });
	}, 10_000).unref();
}

/**
 * Builds the discord.js `Client` and wires up all gateway event routing. Called once from `bin.ts`, which then
 * registers the result into the context (`setServiceValue('client', ...)`) before the rest of the app starts —
 * everything else should reach Discord via `getContext().service.client`, never by importing this file.
 */
export function createClient(): Client {
	const client = new Client({ rest, gateway });

	client
		.on(GatewayDispatchEvents.GuildCreate, ({ data: guild }) => {
			guildIds.add(guild.id);
		})
		.on(GatewayDispatchEvents.GuildDelete, ({ data: guild }) => {
			if (!guild.unavailable) {
				guildIds.delete(guild.id);
			}
		})
		.on(GatewayDispatchEvents.InteractionCreate, async ({ data: interaction }) => {
			// Discord's own interaction id is already a unique, stable correlation key -- no need to mint one
			// ourselves the way the API service does with a `nanoid`. This child logger flows into every
			// handler for the interaction, so the whole course of it can be traced by `interactionId`.
			const logger = getContext().logger.child({ interactionId: interaction.id, interactionType: interaction.type });

			if (interaction.type === InteractionType.MessageComponent) {
				await handleComponentInteraction(interaction, logger);
			} else if (interaction.type === InteractionType.ApplicationCommand) {
				await handleCommandInteraction(interaction, logger);
			} else if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
				await handleAutocompleteInteraction(interaction, logger);
			} else {
				logger.warn('Unhandled interaction type');
			}
		})
		.once(GatewayDispatchEvents.Ready, async ({ data }) => {
			getContext().logger.info('Logged in successfully');

			const applicationId = data.application.id;
			const existingGlobalCommands = await client.api.applicationCommands.getGlobalCommands(applicationId);
			if (existingGlobalCommands.length === 0) {
				const deployHandler = getCommandHandler('deploy');
				if (deployHandler) {
					await client.api.applicationCommands.bulkOverwriteGlobalCommands(applicationId, [deployHandler.data]);
					getContext().logger.info('Bootstrapped deploy command as the only global command');
				} else {
					getContext().logger.warn('No deploy command handler found; skipping global command bootstrap');
				}
			}
		});

	return client;
}
