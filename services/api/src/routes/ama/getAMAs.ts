import type { AMASession } from '@chatsift/core';
import type { Selectable } from 'kysely';
import type { NextHandler, Response } from 'polka';
import { z, input } from 'zod';
import { context } from '../../context.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

const querySchema = z
	.object({
		include_ended: z.stringbool().optional().default(false),
	})
	.strict();

export type GetAMAsQuery = z.input<typeof querySchema>;

export interface AMASessionWithCount extends Selectable<AMASession> {
	questionCount: number;
}

export default class GetAMAs extends Route<AMASessionWithCount[], typeof querySchema> {
	public readonly info = {
		method: RouteMethod.get,
		path: '/v3/guilds/:guildId/ama/amas',
	} as const;

	public override readonly queryValidationSchema = querySchema;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	];

	public override async handle(req: TRequest<typeof querySchema>, res: Response, next: NextHandler) {
		const { include_ended } = req.query;
		const { guildId } = req.params as { guildId: string };

		let query = context.db.selectFrom('AMASession').selectAll().where('guildId', '=', guildId);

		if (!include_ended) {
			query = query.where('ended', '=', false);
		}

		const sessions = await query.orderBy('id', 'desc').execute();

		// Fetch question counts for all sessions
		const sessionIds = sessions.map((s) => s.id);
		const questionCounts = sessionIds.length
			? await context.db
					.selectFrom('AMAQuestion')
					.select(['amaId'])
					.select((eb) => eb.fn.count<string>('id').as('count'))
					.where('amaId', 'in', sessionIds)
					.groupBy('amaId')
					.execute()
			: [];

		// Create a map of session ID to question count
		const countsBySession = new Map<number, number>();
		for (const { amaId, count } of questionCounts) {
			countsBySession.set(amaId, Number(count));
		}

		// Combine sessions with their question counts
		const result: AMASessionWithCount[] = sessions.map((session) => ({
			...session,
			questionCount: countsBySession.get(session.id) ?? 0,
		}));

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify(result));
	}
}
