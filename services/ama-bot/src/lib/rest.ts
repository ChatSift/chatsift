import { REST } from '@discordjs/rest';
import { context } from '../context.js';

export const rest = new REST({ version: '10' }).setToken(context.env.AMA_BOT_TOKEN);
