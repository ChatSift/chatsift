import { getContext } from '@chatsift/backend-core';
import { badRequest, forbidden } from '@hapi/boom';
import { parseCookie } from 'cookie';
import z from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { cookieWithDomain } from '../../util/constants.js';
import { discordAPIOAuth } from '../../util/discordAPI.js';
import { fetchMe } from '../../util/me.js';
import { setEquals } from '../../util/setEquals.js';
import { StateCookie } from '../../util/stateCookie.js';
import { createAccessToken, createRefreshToken } from '../../util/tokens.js';
import { DISCORD_AUTH_SCOPES } from './discord.js';

const querySchema = z.strictObject({
	code: z.string(),
	state: z.string(),
});

// A session already authorized under the pre-#263 scope set (which included `email`) can come back through here
// without a fresh consent prompt -- Discord returns that standing grant's scopes as-is rather than trimming to
// what this request asked for. Handled as an explicit, exact legacy set rather than a general "extra scopes are
// fine" subset check, so scope-tampering via a crafted authorize URL is still rejected for anything outside these
// two known-good sets -- the `state` cookie above is what actually defends against that, but there's no reason to
// widen what this check accepts beyond the one real legacy case.
const LEGACY_DISCORD_AUTH_SCOPES = new Set([...DISCORD_AUTH_SCOPES, 'email']);

export default defineRoute({
	method: 'get',
	path: '/v3/auth/discord/callback',
	schema: {
		query: querySchema,
	},
	middleware: isAuthed({ fallthrough: true, isGlobalAdmin: false }),
	async handler(req, res) {
		if (req.tokens) {
			res.redirect(getContext().FRONTEND_URL);
			res.end();
			return;
		}

		const { code, state: stateQuery } = req.query;

		const parsedCookies = parseCookie(req.headers.cookie ?? '');
		if (stateQuery !== parsedCookies['state']) {
			throw badRequest('bad state');
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
			throw badRequest('state expired');
		}

		const result = await discordAPIOAuth.oauth2.tokenExchange({
			client_id: getContext().env.OAUTH_DISCORD_CLIENT_ID,
			client_secret: getContext().env.OAUTH_DISCORD_CLIENT_SECRET,
			grant_type: 'authorization_code',
			code,
			redirect_uri: `${getContext().API_URL}/v3/auth/discord/callback`,
		});

		const returnedScopes = new Set(result.scope.split(' '));
		if (!setEquals(DISCORD_AUTH_SCOPES, returnedScopes) && !setEquals(LEGACY_DISCORD_AUTH_SCOPES, returnedScopes)) {
			req.logger.warn(
				{ returnedScopes: result.scope, expectedScopes: [...DISCORD_AUTH_SCOPES] },
				'miss matched scopes',
			);
			throw forbidden('received different scopes than expected');
		}

		const me = await fetchMe(result.access_token, req.logger, true);
		createAccessToken(res, result, me);
		createRefreshToken(res, result, me.id);

		res.redirect(state.redirectURI);
		res.end();
	},
});
