import { setInterval } from 'node:timers';
import { getContext, GuildList } from '@chatsift/backend-core';
import type { Snowflake } from '@discordjs/core';
import { Client, GatewayDispatchEvents } from '@discordjs/core';
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
	.once(GatewayDispatchEvents.Ready, () => {
		getContext().logger.info('Logged in successfully');
	});
