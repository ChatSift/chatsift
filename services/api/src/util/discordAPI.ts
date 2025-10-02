import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';

const rest = new REST({ version: '10' });
export const discordAPIOAuth = new API(rest);
