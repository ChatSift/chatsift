import { URLSearchParams } from 'node:url';
import { getContext } from '@chatsift/backend-core';
import type { RESTOAuth2AuthorizationQuery } from '@discordjs/core';
import type { NextHandler, Response } from 'polka';
import { isAuthed } from '../../middleware/isAuthed.js';
import { cookieWithDomain } from '../../util/constants.js';
import { StateCookie } from '../../util/stateCookie.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

export const DISCORD_AUTH_SCOPES = new Set(['identify', 'email', 'guilds', 'guilds.members.read'] as const);

export default class GetAuthDiscord extends Route<never, never> {
	public readonly info = {
		method: RouteMethod.get,
		path: '/v3/auth/discord',
	} as const;

	public override readonly middleware = [...isAuthed({ fallthrough: true, isGlobalAdmin: false })];

	public override async handle(req: TRequest<never>, res: Response, next: NextHandler) {
		if (req.tokens) {
			res.redirect(getContext().FRONTEND_URL);
			return res.end();
		}

		const state = new StateCookie(`${getContext().FRONTEND_URL}/dashboard`).toCookie();
		res.cookie(
			'state',
			state,
			cookieWithDomain({
				httpOnly: true,
				path: '/',
				sameSite: 'lax',
				secure: getContext().env.IS_PRODUCTION,
				maxAge: 10 * 60 * 1_000,
			}),
		);

		const params = {
			client_id: getContext().env.OAUTH_DISCORD_CLIENT_ID,
			redirect_uri: `${getContext().API_URL}/v3/auth/discord/callback`,
			response_type: 'code',
			scope: [...DISCORD_AUTH_SCOPES].join(' '),
			state,
		} satisfies RESTOAuth2AuthorizationQuery;

		res.redirect(`https://discord.com/oauth2/authorize?${new URLSearchParams(params).toString()}`);
		return res.end();
	}
}
