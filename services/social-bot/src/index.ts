import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContext } from '@chatsift/backend-core';
import { registerCommandHandlers, registerUnknownCommandResolver } from '@chatsift/bot-core';
import type { Client } from '@discordjs/core';
import { GatewayDispatchEvents } from '@discordjs/core';
import { handleSocialInteractionCommand } from './lib/interactions.js';
import { handleTrackedMessage } from './lib/tracking.js';

const baseDir = dirname(fileURLToPath(import.meta.url));

/**
 * bot-core's `Client` only dispatches interactions, so the leveling engine attaches its own `MessageCreate`
 * listener -- same approach as `services/modmail-bot`'s relay. The try/catch is mandatory: a rejected listener
 * is re-emitted by discord.js-core as an `'error'` event.
 */
function registerMessageTracking(client: Client): void {
	client.on(GatewayDispatchEvents.MessageCreate, async ({ data: message }) => {
		const logger = getContext().logger.child({
			event: 'messageCreate',
			channelId: message.channel_id,
			guildId: message.guild_id ?? null,
		});

		try {
			await handleTrackedMessage(message, logger);
		} catch (error) {
			logger.error({ err: error }, 'Failed to track a message in social-bot');
		}
	});
}

export async function bin(client: Client): Promise<void> {
	await registerCommandHandlers(join(baseDir, 'commands'));
	registerMessageTracking(client);
	registerUnknownCommandResolver(handleSocialInteractionCommand);
}
