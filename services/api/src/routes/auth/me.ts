import type { APIUser } from '@discordjs/core';
import type { NextHandler, Response } from 'polka';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

export default class GetAuthMe extends Route<APIUser, never> {
	public readonly info = {
		method: RouteMethod.get,
		path: '/v3/auth/me',
	} as const;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false }),
	];

	public override async handle(req: TRequest<never>, res: Response, next: NextHandler) {
		const result: APIUser = req.user!.discordUser;

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify(result));
	}
}
