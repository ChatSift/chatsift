import type { BotId } from '@chatsift/core';
import { createRecipe, DataType } from 'bin-rw';
import { RedisStore } from './_store.js';

interface BotInfo {
	guilds: string[];
}

export const GuildList = new RedisStore<BotInfo, BotId>({
	TTL: null,
	recipe: createRecipe({
		guilds: [DataType.String],
	}),
	makeKey: (id: BotId) => `bot:${id}`,
	storeOld: false,
});
