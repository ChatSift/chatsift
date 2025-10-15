import { getContext } from '@chatsift/backend-core';
import type { AMASession } from '@chatsift/core';
import { badData, notFound } from '@hapi/boom';
import type { Selectable } from 'kysely';
import type { NextHandler, Response } from 'polka';
import { z } from 'zod';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

const bodySchema = z.strictObject({
	ended: z.literal(true),
});

export type UpdateAMABody = z.input<typeof bodySchema>;

export type UpdateAMAResult = Selectable<AMASession>;

export default class UpdateAMA extends Route<UpdateAMAResult, typeof bodySchema> {
	public readonly info = {
		method: RouteMethod.patch,
		path: '/v3/guilds/:guildId/ama/amas/:amaId',
	} as const;

	public override readonly bodyValidationSchema = bodySchema;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	];

	public override async handle(req: TRequest<typeof bodySchema>, res: Response, next: NextHandler) {
		const data = req.body;
		const { guildId, amaId } = req.params as { amaId: string; guildId: string };

		const existingAMA = await getContext()
			.db.selectFrom('AMASession')
			.selectAll()
			.where('guildId', '=', guildId)
			.where('id', '=', Number(amaId))
			.executeTakeFirst();

		if (!existingAMA) {
			return next(notFound('AMA session not found'));
		}

		if (existingAMA.ended) {
			return next(badData('AMA session is already ended'));
		}

		const updated: UpdateAMAResult = await getContext()
			.db.updateTable('AMASession')
			.set({ ended: data.ended })
			.where('id', '=', Number(amaId))
			.where('guildId', '=', guildId)
			.returningAll()
			.executeTakeFirstOrThrow();

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify(updated));
	}
}
