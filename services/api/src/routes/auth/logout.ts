import { getContext } from '@chatsift/backend-core';
import type { NextHandler, Response } from 'polka';
import { isAuthed } from '../../middleware/isAuthed.js';
import { discordAPIOAuth } from '../../util/discordAPI.js';
import { noopAccessToken, noopRefreshToken } from '../../util/tokens.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

export default class PostAuthLogout extends Route<never, never> {
	public readonly info = {
		method: RouteMethod.post,
		path: '/v3/auth/logout',
	} as const;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false }),
	];

	public override async handle(req: TRequest<never>, res: Response, next: NextHandler) {
		await discordAPIOAuth.oauth2.revokeToken(
			getContext().env.OAUTH_DISCORD_CLIENT_ID,
			getContext().env.OAUTH_DISCORD_CLIENT_SECRET,
			{ token: req.tokens!.refresh.discordRefreshToken, token_type_hint: 'refresh_token' },
		);

		noopAccessToken(res);
		noopRefreshToken(res);

		res.statusCode = 200;
		return res.end();
	}
}
