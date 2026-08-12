import { getContext, revokeDashboardSession } from '@chatsift/backend-core';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { discordAPIOAuth } from '../../util/discordAPI.js';
import { noopAccessToken, noopRefreshToken } from '../../util/tokens.js';

export default defineRoute({
	method: 'post',
	path: '/v3/auth/logout',
	middleware: isAuthed({ fallthrough: true, isGlobalAdmin: false }),
	async handler(req, res) {
		// Cookies must be cleared even if the upstream revocation call below fails (Discord hiccup, redis
		// blip) -- a user who clicked "log out" and got an error should never be left still holding a live
		// session locally.
		try {
			const refresh = req.tokens?.refresh;
			if (refresh?.kind === 'scoped') {
				await revokeDashboardSession(refresh.sid);
			} else if (refresh) {
				await discordAPIOAuth.oauth2.revokeToken(
					getContext().env.OAUTH_DISCORD_CLIENT_ID,
					getContext().env.OAUTH_DISCORD_CLIENT_SECRET,
					{ token: refresh.discordRefreshToken, token_type_hint: 'refresh_token' },
				);
			}
		} catch (error) {
			req.logger.warn({ err: error }, 'failed to revoke the upstream session on logout, clearing cookies anyway');
		} finally {
			noopAccessToken(res);
			noopRefreshToken(res);
		}

		res.statusCode = 200;
		res.end();
	},
});
