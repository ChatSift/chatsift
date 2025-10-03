import { badRequest, forbidden } from '@hapi/boom';
import cookie from 'cookie';
import type { NextHandler, Response } from 'polka';
import z from 'zod';
import { context } from '../../context.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { validate } from '../../middleware/validate.js';
import { cookieWithDomain } from '../../util/constants.js';
import { discordAPIOAuth } from '../../util/discordAPI.js';
import { setEquals } from '../../util/setEquals.js';
import { StateCookie } from '../../util/stateCookie.js';
import { createAccessToken, createRefreshToken } from '../../util/tokens.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';
import { DISCORD_AUTH_SCOPES } from './discord.js';

const querySchema = z
	.object({
		code: z.string(),
		state: z.string(),
	})
	.strict();
type Query = z.infer<typeof querySchema>;

export default class GetAuthDiscordCallback extends Route<never, never> {
	public readonly info = {
		method: RouteMethod.get,
		path: '/v3/auth/discord/callback',
	} as const;

	public override readonly middleware = [
		...isAuthed({ fallthrough: true, isGlobalAdmin: false }),
		validate(querySchema, 'query'),
	];

	public override async handle(req: TRequest<never>, res: Response, next: NextHandler) {
		if (req.user) {
			res.redirect(context.env.FRONTEND_URL);
			return res.end();
		}

		const { code, state: stateQuery } = req.query as Query;

		const parsedCookies = cookie.parse(req.headers.cookie ?? '');
		if (stateQuery !== parsedCookies['state']) {
			return next(badRequest('bad state'));
		}

		const state = StateCookie.from(stateQuery);
		// Clear state
		res.cookie('state', 'noop', cookieWithDomain({ httpOnly: true, expires: new Date('1970-01-01') }));

		const result = await discordAPIOAuth.oauth2.tokenExchange({
			client_id: context.env.OAUTH_DISCORD_CLIENT_ID,
			client_secret: context.env.OAUTH_DISCORD_CLIENT_SECRET,
			grant_type: 'authorization_code',
			code,
			redirect_uri: `${context.env.API_URL}/v3/auth/discord/callback`,
		});

		if (!setEquals(DISCORD_AUTH_SCOPES, new Set(result.scope.split(' ')))) {
			context.logger.warn({ returnedScopes: result.scope, expectedScopes: DISCORD_AUTH_SCOPES }, 'miss matched scopes');
			return next(forbidden('received different scopes than expected'));
		}

		const user = await discordAPIOAuth.users.getCurrent({ auth: { token: result.access_token, prefix: 'Bearer' } });

		await createAccessToken(res, result, user);
		createRefreshToken(res, result, user);

		res.redirect(state.redirectURI);
		return res.end();
	}
}
