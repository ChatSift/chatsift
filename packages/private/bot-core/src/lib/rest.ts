import { discordRestProxyOptions, getContext } from '@chatsift/backend-core';
import type { BotId } from '@chatsift/core';
import { REST, RESTEvents } from '@discordjs/rest';
import { Counter, type Registry } from 'prom-client';

export interface CreateBotRestOptions {
	readonly botId: BotId;
	readonly register?: Registry;
	readonly token: string;
}

function registerRestMetrics(rest: REST, botId: BotId, register: Registry): void {
	const discordRequests = new Counter({
		name: 'discord_requests_total',
		help: 'Discord API responses received, by bot, method, rate-limit bucket route, and status',
		labelNames: ['bot', 'method', 'route', 'status'] as const,
		registers: [register],
	});

	rest.on(RESTEvents.Response, (request, response) => {
		discordRequests.inc({
			bot: botId,
			method: request.method.toUpperCase(),
			route: request.route,
			status: String(response.status),
		});
	});
}

export function createBotRest({ botId, register, token }: CreateBotRestOptions): REST {
	const rest = new REST({ version: '10', ...discordRestProxyOptions() }).setToken(token);

	rest.on(RESTEvents.RateLimited, (rateLimitInfo) => {
		getContext().logger.warn(rateLimitInfo, 'Hit a Discord REST rate limit');
	});

	if (register) {
		registerRestMetrics(rest, botId, register);
	}

	return rest;
}
