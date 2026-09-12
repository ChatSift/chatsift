import { getContext, recordAppellantGrant } from '@chatsift/backend-core';
import { forbidden } from '@hapi/boom';
import z from 'zod';
import { defineRoute } from '../../../core/route.js';
import { createAppealsAccessToken, createAppealsRefreshToken } from '../../../util/appealsTokens.js';
import { discordAPIOAuth } from '../../../util/discordAPI.js';
import { consumeOAuthState } from '../../../util/oauthState.js';
import { APPEALS_AUTH_SCOPES, APPEALS_STATE_COOKIE } from './discord.js';

const querySchema = z.strictObject({
	code: z.string(),
	state: z.string(),
});

export default defineRoute({
	method: 'get',
	path: '/v3/appeals/auth/discord/callback',
	schema: {
		query: querySchema,
	},
	// No session middleware, deliberately. This route *is* how a session comes into existence, and an appellant
	// arriving here already signed in is doing something real -- re-authorizing to grant `guilds.join` they
	// declined the first time. Short-circuiting on an existing session, the way the dashboard's callback does
	// for its own unrelated reason, would make that re-grant impossible.
	async handler(req, res) {
		const { code, state: stateQuery } = req.query;
		const state = consumeOAuthState(req, res, APPEALS_STATE_COOKIE, stateQuery);

		const result = await discordAPIOAuth.oauth2.tokenExchange({
			client_id: getContext().env.APPEALS_OAUTH_CLIENT_ID,
			client_secret: getContext().env.APPEALS_OAUTH_CLIENT_SECRET,
			grant_type: 'authorization_code',
			code,
			redirect_uri: `${getContext().APPEALS_API_URL}/v3/appeals/auth/discord/callback`,
		});

		const returnedScopes = new Set(result.scope.split(' '));
		// A *subset* check, unlike `routes/auth/discordCallback.ts`'s exact `setEquals`, and the difference is
		// deliberate rather than an oversight. Two of the three scopes here are optional by design: `guilds.join`
		// is decision 14's appellant half, which they are entitled to refuse, and a user install that grants
		// `identify` alone still identifies them well enough to file an appeal -- it only costs them the DM.
		// What must hold is that nothing *wider* than what was asked for comes back, which is what this checks;
		// the `state` cookie above is what actually defends the exchange itself.
		const unexpectedScopes = [...returnedScopes].filter((scope) => !APPEALS_AUTH_SCOPES.has(scope));
		if (unexpectedScopes.length) {
			req.logger.warn({ returnedScopes: result.scope, unexpectedScopes }, 'appeals login returned unrequested scopes');
			throw forbidden('received different scopes than expected');
		}

		if (!returnedScopes.has('identify')) {
			// Not recoverable and not worth a friendly page: an appeal is filed *as* an account, so without this
			// there is nobody to file it for. Reachable only by hand-editing the authorize URL.
			throw forbidden('the appeals login requires the identify scope');
		}

		const user = await discordAPIOAuth.users.getCurrent({ auth: { prefix: 'Bearer', token: result.access_token } });

		await recordAppellantGrant(user.id, {
			grantedGuildsJoin: returnedScopes.has('guilds.join'),
			// The scope that carries DM permission in a user-install context (§6), and the only thing a login can
			// establish about reachability: without it there is no path to this person at all, which
			// `recordAppellantGrant` writes down as a known-unreachable rather than as an untried unknown.
			grantedUserInstall: returnedScopes.has('applications.commands'),
			refreshToken: result.refresh_token,
		});

		createAppealsAccessToken(res, user.id);
		createAppealsRefreshToken(res, user.id);

		res.redirect(state.redirectURI);
		res.end();
	},
});
