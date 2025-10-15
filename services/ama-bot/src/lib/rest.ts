import { getContext } from '@chatsift/backend-core';
import { REST } from '@discordjs/rest';

export const rest = new REST({ version: '10' }).setToken(getContext().env.AMA_BOT_TOKEN);
