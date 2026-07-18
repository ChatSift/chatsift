import { setInterval } from 'node:timers';
import { getContext, GuildList } from '@chatsift/backend-core';
import type { Snowflake } from '@discordjs/core';
import { InteractionType, Client, GatewayDispatchEvents } from '@discordjs/core';
import { getCommandHandler, handleAutocompleteInteraction, handleCommandInteraction } from './commands.js';
import { handleComponentInteraction } from './components.js';
import { gateway } from './gateway.js';
import { rest } from './rest.js';

// keep a copy of the guild ids we manage here to easily patch redis
const guildIds = new Set<Snowflake>();

export function startGuildSyncing(): void {
	setInterval(async () => {
		void GuildList.set('AMA', { guilds: [...guildIds] });
	}, 10_000).unref();
}

export const client = new Client({ rest, gateway });

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
		if (interaction.type === InteractionType.MessageComponent) {
			await handleComponentInteraction(interaction);
		} else if (interaction.type === InteractionType.ApplicationCommand) {
			await handleCommandInteraction(interaction);
		} else if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
			await handleAutocompleteInteraction(interaction);
		} else {
			getContext().logger.warn({ interactionType: interaction.type }, 'Unhandled interaction type');
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
