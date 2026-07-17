import { getContext } from '@chatsift/backend-core';
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
		await discordAPIOAuth.oauth2.revokeToken(
			getContext().env.OAUTH_DISCORD_CLIENT_ID,
			getContext().env.OAUTH_DISCORD_CLIENT_SECRET,
			{ token: req.tokens!.refresh.discordRefreshToken, token_type_hint: 'refresh_token' },
		);

		noopAccessToken(res);
		noopRefreshToken(res);

		res.statusCode = 200;
		res.end();
	},
});
