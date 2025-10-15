import { notFound } from '@hapi/boom';
import type { NextHandler, Response } from 'polka';
import { z } from 'zod';
import { context } from '../../context.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../util/schemas.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

const bodySchema = z.strictObject({
	userId: snowflakeSchema,
});

export type DeleteGrantBody = z.input<typeof bodySchema>;

export default class DeleteGrant extends Route<never, typeof bodySchema> {
	public readonly info = {
		method: RouteMethod.delete,
		path: '/v3/guilds/:guildId/grants',
	} as const;

	public override readonly bodyValidationSchema = bodySchema;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	];

	public override async handle(req: TRequest<typeof bodySchema>, res: Response, next: NextHandler) {
		const { userId } = req.body;
		const { guildId } = req.params as { guildId: string };

		// Check if the grant exists
		const existingGrant = await context.db
			.selectFrom('DashboardGrant')
			.select('id')
			.where('guildId', '=', guildId)
			.where('userId', '=', userId)
			.executeTakeFirst();

		if (!existingGrant) {
			return next(notFound('grant not found for this user'));
		}

		// Delete the grant
		await context.db.deleteFrom('DashboardGrant').where('guildId', '=', guildId).where('userId', '=', userId).execute();

		res.statusCode = 200;
		return res.end();
	}
}
