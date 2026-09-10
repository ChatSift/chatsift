import { getContext } from '@chatsift/backend-core';
import { badRequest } from '@hapi/boom';
import type { SerializeOptions } from 'cookie';
import { parseCookie } from 'cookie';
import type { Response } from 'polka';
import { StateCookie } from './stateCookie.js';

/**
 * How long a login may sit half-finished before its `state` stops being accepted. One value, not one per
 * flow: this is a bound on how long a CSRF token stays live, and there is no reason for the two sites to
 * disagree about it.
 */
export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1_000;

export interface OAuthStateCookie {
	/**
	 * Distinct per flow so a login started on one site cannot consume the other's -- the two are already
	 * domain-separated, but they redeem against different Discord applications, and a crossed state should
	 * fail loudly rather than confusingly.
	 */
	name: string;
	/**
	 * The flow's own domain-pinning helper (`cookieWithDomain` for the dashboard, `appealsCookieWithDomain` for
	 * `unban.app`), passed in rather than chosen here so this module never has to know which site it is serving.
	 */
	withDomain<Cookie extends SerializeOptions>(cookie: Cookie): Cookie;
}

/**
 * The `state` half of an OAuth handshake, which is the same on both sites and is the part worth having exactly
 * one copy of: it is what stops a third party pasting their own authorization code into somebody's session.
 *
 * Everything *around* it legitimately differs and stays in the routes -- which application is being authorized,
 * which scopes are asked for, how strictly the returned scope set is checked, and what a completed exchange
 * produces. See the two `auth/discord{,Callback}.ts` pairs.
 */
export function issueOAuthState(res: Response, cookie: OAuthStateCookie, redirectURI: string): string {
	const state = new StateCookie(redirectURI).toCookie();

	res.cookie(
		cookie.name,
		state,
		cookie.withDomain({
			httpOnly: true,
			path: '/',
			sameSite: 'lax',
			secure: getContext().env.IS_PRODUCTION,
			maxAge: OAUTH_STATE_MAX_AGE_MS,
		}),
	);

	return state;
}

/**
 * Checks the `state` a callback came back with against the cookie, clears the cookie either way, and returns
 * the decoded value. Throws `badRequest` on a mismatch or an expired state.
 *
 * The cookie is cleared **before** the age check, deliberately: a state that has aged out is spent either way,
 * and leaving it set would let the same stale value be presented again.
 */
export function consumeOAuthState(
	// Narrowed to the one field this reads rather than taking polka's `Request`: `defineRoute` hands handlers a
	// request intersected with its schema's parsed `body`/`query`/`params`, and under `exactOptionalPropertyTypes`
	// that shape is not assignable back to the base `Request`. Asking for what is actually used sidesteps it and
	// documents the dependency at the same time.
	req: { headers: { cookie?: string | undefined } },
	res: Response,
	cookie: OAuthStateCookie,
	stateQuery: string,
): StateCookie {
	if (stateQuery !== parseCookie(req.headers.cookie ?? '')[cookie.name]) {
		throw badRequest('bad state');
	}

	const state = StateCookie.from(stateQuery);

	res.cookie(
		cookie.name,
		'noop',
		cookie.withDomain({
			httpOnly: true,
			expires: new Date(0),
			path: '/',
			// `IS_PRODUCTION` rather than a hardcoded `true`, which is what the dashboard's callback used to
			// clear this with. A `Secure` cookie is ignored wholesale over plain http, so that version silently
			// failed to clear anything in local development -- harmless, since the state is single-use and
			// age-bounded regardless, but there is no reason to keep it.
			secure: getContext().env.IS_PRODUCTION,
			sameSite: 'lax',
		}),
	);

	if (Date.now() - state.createdAt.getTime() > OAUTH_STATE_MAX_AGE_MS) {
		throw badRequest('state expired');
	}

	return state;
}
