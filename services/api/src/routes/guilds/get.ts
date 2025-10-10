import { BOTS } from '@chatsift/backend-core';
import { internal } from '@hapi/boom';
import type { NextHandler, Response } from 'polka';
import z from 'zod';
import { context } from '../../context.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { fetchGuildChannels, type GuildChannelInfo } from '../../util/channels.js';
import { APIMapping } from '../../util/discordAPI.js';
import { fetchMe } from '../../util/me.js';
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

		const me = await fetchMe(req.tokens!.access.discordAccessToken, force_fresh);
		const guild = me.guilds.find((g) => g.id === guildId);
		if (!guild) {
			// Should be impossible because of the auth checks
			context.logger.error({ guildId, userId: me.id }, 'guild not found for user in auth-gated route');
			return next(internal());
		}

		const channels = await fetchGuildChannels(guild, APIMapping[for_bot], force_fresh);
		const result: GetGuildResult = {
			channels,
		};

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify(result));
	}
}
