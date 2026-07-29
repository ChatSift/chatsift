import type { BotId } from '@chatsift/core';
import { createRecipe, DataType } from 'bin-rw';
import { RedisStore } from './_store.js';

interface BotInfo {
	guilds: string[];
}

/**
 * The public deployment of a bot keys its `bot:<BotId>` Redis guild list on the bare `BotId`. A
 * custom, single-guild ModMail instance (#216, docs/roadmap/08-modmail-custom-instances.md) is a
 * second, independently-deployed process sharing that same `BotId`, so it publishes under its own
 * `bot:MODMAIL#<instanceId>` key instead of overwriting the public deployment's.
 */
export type GuildListKey = BotId | `${BotId}#${string}`;

export const GuildList = new RedisStore<BotInfo, GuildListKey>({
	TTL: null,
	recipe: createRecipe({
		guilds: [DataType.String],
	}),
	makeKey: (id: GuildListKey) => `bot:${id}`,
	storeOld: false,
});
