import { getContext } from '@chatsift/backend-core';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, notFound } from '@hapi/boom';
import type { NextHandler, Response } from 'polka';
import { z } from 'zod';
import { isAuthed } from '../../middleware/isAuthed.js';
import { roundRobinAPI } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

const bodySchema = z.strictObject({
	userId: snowflakeSchema,
});

export type CreateGrantBody = z.input<typeof bodySchema>;

export default class CreateGrant extends Route<never, typeof bodySchema> {
	public readonly info = {
		method: RouteMethod.put,
		path: '/v3/guilds/:guildId/grants',
	} as const;

	public override readonly bodyValidationSchema = bodySchema;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	];

	public override async handle(req: TRequest<typeof bodySchema>, res: Response, next: NextHandler) {
		const { userId } = req.body;
		const { guildId } = req.params as { guildId: string };

		const existingGrant = await getContext()
			.db.selectFrom('DashboardGrant')
			.select('id')
			.where('guildId', '=', guildId)
			.where('userId', '=', userId)
			.executeTakeFirst();

		if (existingGrant) {
			return next(badData('grant already exists for this user'));
		}

		try {
			await roundRobinAPI(req.guild!).users.get(userId);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 404) {
				return next(notFound('user not found'));
			}

			throw error;
		}

		await getContext()
			.db.insertInto('DashboardGrant')
			.values({
				guildId,
				userId,
				createdById: req.tokens!.access.sub,
			})
			.execute();

		res.statusCode = 200;
		return res.end();
	}
}
