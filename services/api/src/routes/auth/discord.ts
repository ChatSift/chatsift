import { URLSearchParams } from 'node:url';
import { getContext } from '@chatsift/backend-core';
import type { RESTOAuth2AuthorizationQuery } from '@discordjs/core';
import z from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { cookieWithDomain } from '../../util/constants.js';
import { sanitizeRedirectTo } from '../../util/redirectTo.js';
import { StateCookie } from '../../util/stateCookie.js';

export const DISCORD_AUTH_SCOPES = new Set(['identify', 'email', 'guilds', 'guilds.members.read'] as const);

const querySchema = z.strictObject({
	redirect_to: z.string().optional(),
});

export default defineRoute({
	method: 'get',
	path: '/v3/auth/discord',
	schema: {
		query: querySchema,
	},
	middleware: isAuthed({ fallthrough: true, isGlobalAdmin: false }),
	handler(req, res) {
		const redirectPath = sanitizeRedirectTo(req.query.redirect_to, req.logger);

		if (req.tokens) {
			res.redirect(`${getContext().FRONTEND_URL}${redirectPath}`);
			res.end();
			return;
		}

		const state = new StateCookie(`${getContext().FRONTEND_URL}${redirectPath}`).toCookie();
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
		res.end();
	},
});
