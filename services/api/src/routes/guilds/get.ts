import { BOTS } from '@chatsift/backend-core';
import { notFound } from '@hapi/boom';
import type { NextHandler, Response } from 'polka';
import z from 'zod';
import { isAuthed } from '../../middleware/isAuthed.js';
import { fetchGuildChannels, type GuildChannelInfo } from '../../util/channels.js';
import { APIMapping } from '../../util/discordAPI.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

export type { GuildChannelInfo } from '../../util/channels.js';

const querySchema = z.strictObject({
	for_bot: z.enum(BOTS),
	force_fresh: z.stringbool().optional().default(false),
});
export type GetGuildQuery = z.input<typeof querySchema>;

export interface GetGuildResult {
	channels: GuildChannelInfo[];
}

export default class GetGuild extends Route<GetGuildResult, typeof querySchema> {
	public readonly info = {
		method: RouteMethod.get,
		path: '/v3/guilds/:guildId',
	} as const;

	public override readonly queryValidationSchema = querySchema;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	];

	public override async handle(req: TRequest<typeof querySchema>, res: Response, next: NextHandler) {
		const { guildId } = req.params as { guildId: string };
		const { force_fresh, for_bot } = req.query;

		const channels = await fetchGuildChannels(guildId, APIMapping[for_bot], force_fresh);
		if (!channels) {
			return next(notFound('guild not found or bot not in guild'));
		}

		const result: GetGuildResult = {
			channels,
		};

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify(result));
	}
}
