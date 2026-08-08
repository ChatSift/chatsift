import { getContext, revokeDashboardSession } from '@chatsift/backend-core';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { discordAPIOAuth } from '../../util/discordAPI.js';
import { noopAccessToken, noopRefreshToken } from '../../util/tokens.js';

export default defineRoute({
	method: 'post',
	path: '/v3/auth/logout',
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: false,
	}),
	async handler(req, res) {
		// Cookies must be cleared even if the upstream revocation call below fails (Discord hiccup, redis
		// blip) -- a user who clicked "log out" and got an error should never be left still holding a live
		// session locally.
		try {
			if (req.tokens!.refresh.kind === 'scoped') {
				await revokeDashboardSession(req.tokens!.refresh.sid);
			} else {
				await discordAPIOAuth.oauth2.revokeToken(
					getContext().env.OAUTH_DISCORD_CLIENT_ID,
					getContext().env.OAUTH_DISCORD_CLIENT_SECRET,
					{ token: req.tokens!.refresh.discordRefreshToken, token_type_hint: 'refresh_token' },
				);
			}
		} finally {
			noopAccessToken(res);
			noopRefreshToken(res);
		}

		res.statusCode = 200;
		res.end();
	},
});
