import { defineRoute } from '../../../core/route.js';
import { noopAppealsAccessToken, noopAppealsRefreshToken } from '../../../util/appealsTokens.js';

export default defineRoute({
	method: 'post',
	path: '/v3/appeals/auth/logout',
	// No session middleware: clearing cookies is unconditional, and reading a session first would only mean
	// somebody whose cookie had already gone bad could not clear the bad one.
	handler(_req, res) {
		// Cookies only. **The Discord grant is deliberately left alive**, unlike `routes/auth/logout.ts`, which
		// revokes it -- and this is the one place the two sessions behave differently on purpose.
		//
		// The appellant's refresh token in `appeal_user_state` is the same grant this would revoke, and decision
		// 14's re-add on approval spends it days or weeks from now. Revoking here would mean "log out of
		// unban.app" silently downgraded every pending appeal of theirs from "we can put you back in the server"
		// to "here is an invite, good luck" -- a consequence nobody clicking log out is expecting, on a decision
		// that has not been made yet. Somebody who actually wants the grant gone revokes it from Discord's own
		// Authorized Apps screen, which is the honest place for it and says what it does.
		noopAppealsAccessToken(res);
		noopAppealsRefreshToken(res);

		res.statusCode = 200;
		res.end();
	},
});
