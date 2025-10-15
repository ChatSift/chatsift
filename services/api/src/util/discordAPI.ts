import { getContext, type BotId } from '@chatsift/backend-core';
import type { Snowflake } from '@discordjs/core';
import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import type { MeGuild } from './me.js';

const oauthREST = new REST({ version: '10' });
export const discordAPIOAuth = new API(oauthREST);

const amaREST = new REST({ version: '10' }).setToken(getContext().env.AMA_BOT_TOKEN);
export const discordAPIAma = new API(amaREST);

export const APIMapping: Record<BotId, API> = {
	AMA: discordAPIAma,
};

const latest = new Map<Snowflake, number>();
export function roundRobinAPI(guild: MeGuild): API {
	if (guild.bots.length === 1) {
		return APIMapping[guild.bots[0]!];
	}

	const index = latest.get(guild.id) ?? -1;
	const nextIndex = (index + 1) % guild.bots.length;
	latest.set(guild.id, nextIndex);

	return APIMapping[guild.bots[nextIndex]!];
}
