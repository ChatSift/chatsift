import { REST } from '@discordjs/rest';

export interface CreateBotRestOptions {
	readonly token: string;
}

export function createBotRest({ token }: CreateBotRestOptions): REST {
	return new REST({ version: '10' }).setToken(token);
}
