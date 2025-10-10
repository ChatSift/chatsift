import type { BotId } from '@chatsift/backend-core';
import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { context } from '../context.js';

const oauthREST = new REST({ version: '10' });
export const discordAPIOAuth = new API(oauthREST);

const amaREST = new REST({ version: '10' }).setToken(context.env.AMA_BOT_TOKEN);
export const discordAPIAma = new API(amaREST);

export const APIMapping: Record<BotId, API> = {
	AMA: discordAPIAma,
};
