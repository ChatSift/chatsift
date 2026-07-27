import { getContext } from '@chatsift/backend-core';
import { REST, RESTEvents } from '@discordjs/rest';

export interface CreateBotRestOptions {
	readonly token: string;
}

export function createBotRest({ token }: CreateBotRestOptions): REST {
	const rest = new REST({ version: '10' }).setToken(token);

	rest.on(RESTEvents.RateLimited, (rateLimitInfo) => {
		getContext().logger.warn(rateLimitInfo, 'Hit a Discord REST rate limit');
	});

	return rest;
}
