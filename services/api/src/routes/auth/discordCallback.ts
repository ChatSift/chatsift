import { getContext } from '@chatsift/backend-core';
import { badRequest, forbidden } from '@hapi/boom';
import cookie from 'cookie';
import type { NextHandler, Response } from 'polka';
import z from 'zod';
import { isAuthed } from '../../middleware/isAuthed.js';
import { cookieWithDomain } from '../../util/constants.js';
import { discordAPIOAuth } from '../../util/discordAPI.js';
import { fetchMe } from '../../util/me.js';
import { setEquals } from '../../util/setEquals.js';
import { StateCookie } from '../../util/stateCookie.js';
import { createAccessToken, createRefreshToken } from '../../util/tokens.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';
import { DISCORD_AUTH_SCOPES } from './discord.js';

const querySchema = z.strictObject({
	code: z.string(),
	state: z.string(),
});

export default class GetAuthDiscordCallback extends Route<never, typeof querySchema> {
	public readonly info = {
		method: RouteMethod.get,
		path: '/v3/auth/discord/callback',
	} as const;

	public override readonly queryValidationSchema = querySchema;

	public override readonly middleware = [...isAuthed({ fallthrough: true, isGlobalAdmin: false })];

	public override async handle(req: TRequest<typeof querySchema>, res: Response, next: NextHandler) {
		if (req.tokens) {
			res.redirect(getContext().FRONTEND_URL);
			return res.end();
		}

		const { code, state: stateQuery } = req.query;

		const parsedCookies = cookie.parse(req.headers.cookie ?? '');
		if (stateQuery !== parsedCookies['state']) {
			return next(badRequest('bad state'));
		}

		const state = StateCookie.from(stateQuery);
		// Clear state
		res.cookie(
			'state',
			'noop',
			cookieWithDomain({ httpOnly: true, expires: new Date('1970-01-01'), path: '/', secure: true, sameSite: 'lax' }),
		);

		const stateAge = Date.now() - state.createdAt.getTime();
		const MAX_STATE_AGE = 10 * 60 * 1_000; // 10 minutes
		if (stateAge > MAX_STATE_AGE) {
			return next(badRequest('state expired'));
		}

		const result = await discordAPIOAuth.oauth2.tokenExchange({
			client_id: getContext().env.OAUTH_DISCORD_CLIENT_ID,
			client_secret: getContext().env.OAUTH_DISCORD_CLIENT_SECRET,
			grant_type: 'authorization_code',
			code,
			redirect_uri: `${getContext().API_URL}/v3/auth/discord/callback`,
		});

		if (!setEquals(DISCORD_AUTH_SCOPES, new Set(result.scope.split(' ')))) {
			getContext().logger.warn(
				{ returnedScopes: result.scope, expectedScopes: DISCORD_AUTH_SCOPES },
				'miss matched scopes',
			);
			return next(forbidden('received different scopes than expected'));
		}

		const me = await fetchMe(result.access_token, true);
		createAccessToken(res, result, me);
		createRefreshToken(res, result, me.id);

		res.redirect(state.redirectURI);
		return res.end();
	}
}
