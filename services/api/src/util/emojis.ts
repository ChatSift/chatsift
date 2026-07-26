import type { BotId } from '@chatsift/backend-core';
import type { API } from '@discordjs/core';
import { createRecipe, DataType } from 'bin-rw';
import { createCachedGuildFetcher } from './guildDataCache.js';

export interface GuildEmojiInfo {
	animated: boolean;
	id: string;
	name: string;
}

async function fetchGuildEmojisRaw(guildId: string, api: API): Promise<GuildEmojiInfo[]> {
	const emojisRaw = await api.guilds.getEmojis(guildId);

	// `id`/`name` are typed nullable on discord-api-types' shared `APIPartialEmoji` base only for the
	// reaction-emoji case (a unicode emoji reaction) -- a guild's own custom emoji list from this endpoint always
	// has both populated.
	return emojisRaw.map(({ id, name, animated }) => ({ id: id!, name: name!, animated: animated ?? false }));
}

const emojisFetcher = createCachedGuildFetcher(
	'emojis',
	createRecipe({
		items: [
			{
				id: DataType.String,
				name: DataType.String,
				animated: DataType.Bool,
			},
		],
	}),
	fetchGuildEmojisRaw,
);

export async function fetchGuildEmojis(guildId: string, botId: BotId, force = false): Promise<GuildEmojiInfo[] | null> {
	return emojisFetcher.fetch(guildId, botId, force);
}
