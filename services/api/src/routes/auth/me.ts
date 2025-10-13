import type { NextHandler, Response } from 'polka';
import z from 'zod';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { Me } from '../../util/me.js';
import { fetchMe } from '../../util/me.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

export type { Me, MeGuild } from '../../util/me.js';

const querySchema = z.strictObject({
	force_fresh: z.stringbool().optional().default(false),
});
export type GetAuthMeQuery = z.input<typeof querySchema>;

export default class GetAuthMe extends Route<Me, typeof querySchema> {
	public readonly info = {
		method: RouteMethod.get,
		path: '/v3/auth/me',
	} as const;

	public override readonly queryValidationSchema = querySchema;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false }),
	];

	public override async handle(req: TRequest<typeof querySchema>, res: Response, next: NextHandler) {
		const { force_fresh } = req.query;

		const result: Me = await fetchMe(req.tokens!.access.discordAccessToken, force_fresh);

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify(result));
	}
}
