import { createRecipe, DataType } from 'bin-rw';

export const BOTS = ['AMA'] as const;

export type BotId = (typeof BOTS)[number];

// TODO: Abstract
export const GlobalCaches = {
	/**
	 * Not to be used in such a way to risk race conditions. There should really be one place that sets this per bot,
	 * in the gateway, and then as many readers as needed.
	 */
	GuildList: {
		key: (id: BotId) => `bot:${id}:guilds`,
		recipe: createRecipe({
			guilds: [DataType.String],
		}),
	},
} as const;
