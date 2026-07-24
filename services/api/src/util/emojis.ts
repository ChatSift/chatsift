import type { API } from '@discordjs/core';
import { createCachedGuildFetcher } from './guildDataCache.js';

export interface GuildEmojiInfo {
	animated: boolean;
	id: string | null;
	name: string | null;
}

async function fetchGuildEmojisRaw(guildId: string, api: API): Promise<GuildEmojiInfo[]> {
	const emojisRaw = await api.guilds.getEmojis(guildId);

	return emojisRaw.map(({ id, name, animated }) => ({ id, name, animated: animated ?? false }));
}

const emojisFetcher = createCachedGuildFetcher(fetchGuildEmojisRaw);

export function clearCache() {
	emojisFetcher.clearCache();
}

export async function fetchGuildEmojis(guildId: string, api: API, force = false): Promise<GuildEmojiInfo[] | null> {
	return emojisFetcher.fetch(guildId, api, force);
}
