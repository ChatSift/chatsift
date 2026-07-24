import { setInterval } from 'node:timers';
import type { BotId } from '@chatsift/backend-core';
import { getContext, GuildList } from '@chatsift/backend-core';
import type { Snowflake } from '@discordjs/core';
import { InteractionType, Client, GatewayDispatchEvents } from '@discordjs/core';
import type { REST } from '@discordjs/rest';
import type { WebSocketManager } from '@discordjs/ws';
import {
	getCommandHandler,
	handleAutocompleteInteraction,
	handleCommandInteraction,
	registerCommandHandler,
} from './commands.js';
import { handleComponentInteraction } from './components.js';
import DeployCommand from './deploy.js';

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

export interface CreateBotClientOptions {
	/**
	 * Identifies which bot this is for the `bot:<BotId>` guild-list Redis key that the dashboard/API reads to know
	 * which guilds the bot is in.
	 */
	readonly botId: BotId;
	readonly gateway: WebSocketManager;
	readonly rest: REST;
}

/**
 * Builds the discord.js `Client` and wires up all gateway event routing: guild-set tracking with a periodic Redis
 * sync, interaction dispatch (component/command/autocomplete), and the fresh-app bootstrap that seeds `/deploy` as
 * the only global command so an admin has something to run. Also registers the shared `/deploy` command itself, so
 * callers never need to discover or wire it up on their own.
 *
 * Callers register the result into the context themselves (`setServiceValue('client', ...)`) before the rest of
 * the app starts — everything else should reach Discord via `getContext().service.client`, never by importing this
 * file.
 */
export function createBotClient({ botId, gateway, rest }: CreateBotClientOptions): Client {
	registerCommandHandler(new DeployCommand());

	// keep a copy of the guild ids we manage here to easily patch redis
	const guildIds = new Set<Snowflake>();

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

	setInterval(async () => {
		void GuildList.set(botId, { guilds: [...guildIds] });
	}, 10_000).unref();

	return client;
}
