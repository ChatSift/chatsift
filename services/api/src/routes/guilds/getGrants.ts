import type { APIUser, Snowflake } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import type { NextHandler, Response } from 'polka';
import { context } from '../../context.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { roundRobinAPI } from '../../util/discordAPI.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

export interface GetGrantsResult {
	users: (APIUser | Snowflake)[];
}

export default class GetGrants extends Route<GetGrantsResult, never> {
	public readonly info = {
		method: RouteMethod.get,
		path: '/v3/guilds/:guildId/grants',
	} as const;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	];

	public override async handle(req: TRequest<never>, res: Response, next: NextHandler) {
		const { guildId } = req.params as { guildId: string };

		const grants = await context.db
			.selectFrom('DashboardGrant')
			.select('userId')
			.where('guildId', '=', guildId)
			.execute();

		const api = roundRobinAPI(req.guild!);
		const users = await Promise.all(
			grants.map(async ({ userId }) => {
				try {
					return await api.users.get(userId);
				} catch (error) {
					if (error instanceof DiscordAPIError && error.status === 404) {
						return userId;
					}

					throw error;
				}
			}),
		);

		const result: GetGrantsResult = {
			users,
		};

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify(result));
	}
}
