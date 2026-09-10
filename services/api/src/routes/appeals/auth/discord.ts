import { URLSearchParams } from 'node:url';
import { getContext } from '@chatsift/backend-core';
import { ApplicationIntegrationType } from '@discordjs/core';
import z from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAppealsAuthed } from '../../../middleware/isAppealsAuthed.js';
import { appealsCookieWithDomain } from '../../../util/appealsTokens.js';
import { sanitizeAppealsRedirectTo } from '../../../util/redirectTo.js';
import { StateCookie } from '../../../util/stateCookie.js';

/**
 * What `unban.app` asks a banned user to hand over, and why each one is here -- this consent screen is shown to
 * somebody who has every reason to distrust it, so nothing is requested "while we're at it" (#232 §6).
 *
 * - `identify` is the appeal itself: an appeal is filed *as* a Discord account, and the ban probe needs to know
 *   which one.
 * - `applications.commands`, **as a user install**, is what makes the decision deliverable at all. There is no
 *   OAuth scope that grants DM permission; a user install of the application is the only mechanism, documented
 *   as a footnote on this scope and confirmed by hand on 2026-08-03. Without it an approval or a denial has
 *   nowhere to go, because the appellant shares no guild with the bot by construction -- they are banned from
 *   the one guild they would have shared.
 * - `guilds.join` is decision 14's appellant half: approving an appeal can put them back in the server rather
 *   than only lifting the ban. Their half of a two-sided opt-in, so a refusal here is a supported outcome (the
 *   approval DMs an invite instead), not an error.
 *
 * `guilds` is deliberately **not** here. It reveals every server the user is in, buys nothing for a ban appeal
 * (they are not a member of the guild in question -- that is what a ban is), and P9 is the phase that adds it,
 * for timeouts, where membership is the whole discovery mechanism.
 */
export const APPEALS_AUTH_SCOPES = new Set<string>(['identify', 'applications.commands', 'guilds.join']);

const querySchema = z.strictObject({
	redirect_to: z.string().optional(),
});

/**
 * `unban.app`'s state cookie. A different name from the dashboard's `state` so that a login started on one site
 * cannot consume the other's -- the cookies are already domain-separated, but the two flows differ in which
 * OAuth application they redeem against, and a crossed state would be a confusing failure rather than a loud
 * one.
 */
export const APPEALS_STATE_COOKIE = 'appeals_state';

export const APPEALS_STATE_MAX_AGE_MS = 10 * 60 * 1_000;

export default defineRoute({
	method: 'get',
	path: '/v3/appeals/auth/discord',
	schema: {
		query: querySchema,
	},
	middleware: isAppealsAuthed({ fallthrough: true }),
	handler(req, res) {
		const redirectPath = sanitizeAppealsRedirectTo(req.query.redirect_to, req.logger);

		if (req.appellant) {
			res.redirect(`${getContext().APPEALS_FRONTEND_URL}${redirectPath}`);
			res.end();
			return;
		}

		const state = new StateCookie(`${getContext().APPEALS_FRONTEND_URL}${redirectPath}`).toCookie();
		res.cookie(
			APPEALS_STATE_COOKIE,
			state,
			appealsCookieWithDomain({
				httpOnly: true,
				path: '/',
				sameSite: 'lax',
				secure: getContext().env.IS_PRODUCTION,
				maxAge: APPEALS_STATE_MAX_AGE_MS,
			}),
		);

		// `integration_type=1` is the load-bearing parameter, not a detail: it is what makes this a *user*
		// install, and therefore what turns `applications.commands` into DM permission. Drop it and the whole
		// flow still works right up until a decision needs delivering, weeks later, to somebody who cannot be
		// reached -- so it is spelled out here rather than left to a default.
		const params = {
			client_id: getContext().env.APPEALS_OAUTH_CLIENT_ID,
			integration_type: String(ApplicationIntegrationType.UserInstall),
			redirect_uri: `${getContext().API_URL}/v3/appeals/auth/discord/callback`,
			response_type: 'code',
			scope: [...APPEALS_AUTH_SCOPES].join(' '),
			state,
		};

		res.redirect(`https://discord.com/oauth2/authorize?${new URLSearchParams(params).toString()}`);
		res.end();
	},
});
