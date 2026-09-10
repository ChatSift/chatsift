import { AppealsRefreshTokenCookie, getContext, NewAccessTokenHeader } from '@chatsift/backend-core';
import type { SerializeOptions } from 'cookie';
import jwt from 'jsonwebtoken';
import type { Response } from 'polka';

/**
 * `unban.app`'s cookie domain, which is `APPEALS_ROOT_DOMAIN` and never `ROOT_DOMAIN` -- the two frontends are
 * different eTLD+1s and a cookie scoped to one is unreachable from the other by construction, which is the
 * outermost of the three layers keeping the sessions apart (see `AppealsRefreshTokenCookie` for the other two).
 *
 * A twin of `constants.ts`'s `cookieWithDomain` rather than a parameter on it: every call site of either one
 * wants exactly one of the two domains, and a function that takes which-domain-am-I as an argument is one a
 * future route can pass the wrong value to.
 */
export const appealsCookieWithDomain = <Cookie extends SerializeOptions>(cookie: Cookie): Cookie => ({
	...cookie,
	domain: getContext().env.IS_PRODUCTION ? getContext().env.APPEALS_ROOT_DOMAIN : undefined,
});

/**
 * An appellant's session, and deliberately the whole of it: a user id and nothing else.
 *
 * No Discord credential is embedded here, unlike `OAuthAccessTokenData`/`OAuthRefreshTokenData`. A dashboard
 * session has to keep its user's Discord access token alive because every request re-derives what guilds they
 * may manage from Discord. An appeals session grants no authority over anything but this user's own appeals,
 * and the identity in `sub` was established once, at the callback, by an authorization code Discord itself
 * validated. So the pair below is a plain signed session with no upstream to keep in step, and the whole
 * refresh dance (`isAuthed`'s `refreshOAuth`, `discordOAuthRefresh.ts`'s coalescing, #384's `invalid_client`
 * trap) has no counterpart on this path at all.
 *
 * The appellant's Discord refresh token still gets stored -- encrypted, in `appeal_user_state`, by the callback
 * -- because decision 14's re-add on approval happens days or weeks later and must not depend on them still
 * having a browser session open. That is a *credential for a later action*, not the session, and the two are
 * kept in different places for exactly that reason.
 */
export interface AppealsAccessTokenData {
	iat: number;
	kind: 'appeals';
	refresh: false;
	sub: string;
}

export interface AppealsRefreshTokenData {
	iat: number;
	kind: 'appeals';
	refresh: true;
	sub: string;
}

/**
 * Matches `createAccessToken`'s five minutes, and for the same reason: `apps/appeals` reuses `@chatsift/web-core`'s
 * fetch layer, whose server-side token cache (`serverTokenCache.ts`) evicts on exactly this interval.
 */
const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;

/**
 * Thirty days, matching the dashboard's. An appellant is asked to come back and check on a decision that a
 * moderator may take weeks to make, so a session shorter than the product's own turnaround would mean re-authing
 * to read "still under review".
 */
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export function createAppealsAccessToken(res: Response, sub: string): AppealsAccessTokenData {
	const data: AppealsAccessTokenData = {
		iat: Math.floor(Date.now() / 1_000),
		kind: 'appeals',
		refresh: false,
		sub,
	};

	res.setHeader(
		NewAccessTokenHeader,
		jwt.sign(data, getContext().env.ENCRYPTION_KEY, { expiresIn: ACCESS_TOKEN_TTL_SECONDS }),
	);

	return data;
}

export function createAppealsRefreshToken(res: Response, sub: string): AppealsRefreshTokenData {
	const now = Date.now();
	const data: AppealsRefreshTokenData = {
		iat: Math.floor(now / 1_000),
		kind: 'appeals',
		refresh: true,
		sub,
	};

	res.cookie(
		AppealsRefreshTokenCookie,
		jwt.sign(data, getContext().env.ENCRYPTION_KEY, { expiresIn: REFRESH_TOKEN_TTL_MS / 1_000 }),
		appealsCookieWithDomain({
			expires: new Date(now + REFRESH_TOKEN_TTL_MS),
			path: '/',
			sameSite: 'lax',
			httpOnly: true,
			secure: getContext().env.IS_PRODUCTION,
		}),
	);

	return data;
}

export function noopAppealsAccessToken(res: Response): void {
	res.setHeader(NewAccessTokenHeader, 'noop');
}

export function noopAppealsRefreshToken(res: Response): void {
	res.cookie(
		AppealsRefreshTokenCookie,
		'noop',
		appealsCookieWithDomain({
			expires: new Date(0),
			path: '/',
			sameSite: 'lax',
			httpOnly: true,
			secure: getContext().env.IS_PRODUCTION,
		}),
	);
}
