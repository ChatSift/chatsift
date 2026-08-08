import { encrypt, getContext, NewAccessTokenHeader, RefreshTokenCookie } from '@chatsift/backend-core';
import type { Snowflake, RESTPostOAuth2AccessTokenResult } from '@discordjs/core';
import jwt from 'jsonwebtoken';
import type { Response } from 'polka';
import { cookieWithDomain } from './constants.js';
import type { Me } from './me.js';

interface AccessTokenGrants {
	adminGuilds: Snowflake[];
}

function getTokenGrants(me: Me): AccessTokenGrants {
	return {
		adminGuilds: me.guilds.filter((guild) => guild.meCanManage).map((guild) => guild.id),
	};
}

export interface OAuthAccessTokenData {
	discordAccessToken: string;
	grants: AccessTokenGrants;
	iat: number;
	kind: 'oauth';
	refresh: false;
	sub: string;
}

/**
 * Session minted by the `/dashboard` link exchange (`routes/auth/dashboardLink.ts`) rather than a full OAuth
 * login -- `grants.adminGuilds` is always exactly `[guildId]`, which is what lets every existing
 * `isGuildManager`/`isGuildManagerToken` check in `middleware/isAuthed.ts` treat it identically to an OAuth
 * session without a separate code path. `sid` ties this token back to the redis-backed session registry
 * (`@chatsift/backend-core`'s `dashboardSession.ts`) so it can be revoked before its natural expiry.
 */
export interface ScopedAccessTokenData {
	grants: AccessTokenGrants;
	guildId: string;
	iat: number;
	kind: 'scoped';
	refresh: false;
	sid: string;
	sub: string;
}

export type AccessTokenData = OAuthAccessTokenData | ScopedAccessTokenData;

export interface OAuthRefreshTokenData {
	discordAccessToken: string;
	discordAccessTokenExpiresAt: string;
	discordRefreshToken: string;
	iat: number;
	kind: 'oauth';
	refresh: true;
	sub: string;
}

export interface ScopedRefreshTokenData {
	/**
	 * Absolute wall-clock cutoff for this session (session start + `DASHBOARD_SESSION_TTL_SECONDS`) -- unlike
	 * an OAuth refresh token, rotating this one (`createScopedRefreshToken`) never pushes this value forward,
	 * only shrinks the token's own `expiresIn` to whatever remains of it.
	 */
	absoluteExpiresAt: string;
	guildId: string;
	iat: number;
	kind: 'scoped';
	refresh: true;
	sid: string;
	sub: string;
}

export type RefreshTokenData = OAuthRefreshTokenData | ScopedRefreshTokenData;

type OAuthData = Pick<RESTPostOAuth2AccessTokenResult, 'access_token' | 'refresh_token'> &
	(Pick<RESTPostOAuth2AccessTokenResult, 'expires_in'> | { expires_at: string });

export function createAccessToken(res: Response, oauthData: OAuthData, user: Me): OAuthAccessTokenData {
	const iat = Math.floor(Date.now() / 1_000);

	const { access_token: discordAccessToken } = oauthData;
	const accessTokenData: OAuthAccessTokenData = {
		iat,
		kind: 'oauth',
		refresh: false,
		sub: user.id,
		discordAccessToken,
		grants: getTokenGrants(user),
	};

	// The Discord access token is Discord's own credential, not ours -- encrypted here (not just signed) so it isn't
	// plaintext-readable from a decoded JWT if the `X-Update-Access-Token` header value ever leaks.
	const accessToken = jwt.sign(
		{ ...accessTokenData, discordAccessToken: encrypt(discordAccessToken) },
		getContext().env.ENCRYPTION_KEY,
		{ expiresIn: 5 * 60 },
	);
	res.setHeader(NewAccessTokenHeader, accessToken);

	return accessTokenData;
}

/**
 * Same 5-minute lifetime and `X-Update-Access-Token` delivery as `createAccessToken`, for a guild-scoped
 * `/dashboard` session. No Discord credential to encrypt here -- there's no user OAuth token backing this
 * session at all, see `util/me.ts`'s `fetchMeForScopedSession`.
 */
export function createScopedAccessToken(
	res: Response,
	data: Pick<ScopedAccessTokenData, 'guildId' | 'sid' | 'sub'>,
): ScopedAccessTokenData {
	const iat = Math.floor(Date.now() / 1_000);

	const accessTokenData: ScopedAccessTokenData = {
		iat,
		kind: 'scoped',
		refresh: false,
		sub: data.sub,
		guildId: data.guildId,
		sid: data.sid,
		grants: { adminGuilds: [data.guildId] },
	};

	const accessToken = jwt.sign(accessTokenData, getContext().env.ENCRYPTION_KEY, { expiresIn: 5 * 60 });
	res.setHeader(NewAccessTokenHeader, accessToken);

	return accessTokenData;
}

export function noopAccessToken(res: Response): void {
	res.setHeader(NewAccessTokenHeader, 'noop');
}

export function createRefreshToken(res: Response, oauthData: OAuthData, sub: string): OAuthRefreshTokenData {
	const now = Date.now();
	const iat = Math.floor(now / 1_000);

	const { access_token: discordAccessToken, refresh_token: discordRefreshToken } = oauthData;
	const discordAccessTokenExpiresAt =
		'expires_at' in oauthData ? oauthData.expires_at : new Date(now + oauthData.expires_in * 1_000).toISOString();

	const refreshTokenData: OAuthRefreshTokenData = {
		discordAccessToken,
		iat,
		kind: 'oauth',
		refresh: true,
		sub,
		discordRefreshToken,
		discordAccessTokenExpiresAt,
	};

	// Same reasoning as createAccessToken above -- these are Discord's own credentials, encrypted (not just signed)
	// so they aren't plaintext-readable from a decoded JWT if the refresh_token cookie ever leaks.
	const refreshToken = jwt.sign(
		{
			...refreshTokenData,
			discordAccessToken: encrypt(discordAccessToken),
			discordRefreshToken: encrypt(discordRefreshToken),
		},
		getContext().env.ENCRYPTION_KEY,
		{ expiresIn: '30d' },
	);
	res.cookie(
		RefreshTokenCookie,
		refreshToken,
		cookieWithDomain({
			expires: new Date(now + 30 * 24 * 60 * 60 * 1_000),
			path: '/',
			sameSite: 'lax',
			httpOnly: true,
			secure: getContext().env.IS_PRODUCTION,
		}),
	);

	return refreshTokenData;
}

/**
 * Refresh-token equivalent of `createScopedAccessToken`. `expiresIn`/the cookie's `expires` are both clamped to
 * whatever remains until `data.absoluteExpiresAt` -- unlike `createRefreshToken`'s flat 30 days, rotating this
 * token can only ever shrink its remaining lifetime, never extend it, which is what makes the session's 30-minute
 * cap absolute rather than sliding.
 */
export function createScopedRefreshToken(
	res: Response,
	data: Pick<ScopedRefreshTokenData, 'absoluteExpiresAt' | 'guildId' | 'sid' | 'sub'>,
): ScopedRefreshTokenData {
	const now = Date.now();
	const iat = Math.floor(now / 1_000);

	const refreshTokenData: ScopedRefreshTokenData = {
		iat,
		kind: 'scoped',
		refresh: true,
		sub: data.sub,
		guildId: data.guildId,
		sid: data.sid,
		absoluteExpiresAt: data.absoluteExpiresAt,
	};

	const remainingMs = Math.max(1_000, new Date(data.absoluteExpiresAt).getTime() - now);

	const refreshToken = jwt.sign(refreshTokenData, getContext().env.ENCRYPTION_KEY, {
		expiresIn: Math.floor(remainingMs / 1_000),
	});
	res.cookie(
		RefreshTokenCookie,
		refreshToken,
		cookieWithDomain({
			expires: new Date(now + remainingMs),
			path: '/',
			sameSite: 'lax',
			httpOnly: true,
			secure: getContext().env.IS_PRODUCTION,
		}),
	);

	return refreshTokenData;
}

export function noopRefreshToken(res: Response): void {
	res.cookie(
		RefreshTokenCookie,
		'noop',
		cookieWithDomain({
			expires: new Date(1_970),
			path: '/',
			sameSite: 'lax',
			httpOnly: true,
			secure: getContext().env.IS_PRODUCTION,
		}),
	);
}
