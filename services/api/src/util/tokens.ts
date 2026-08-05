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

export interface AccessTokenData {
	discordAccessToken: string;
	grants: AccessTokenGrants;
	iat: number;
	refresh: false;
	sub: string;
}

export interface RefreshTokenData {
	discordAccessToken: string;
	discordAccessTokenExpiresAt: string;
	discordRefreshToken: string;
	iat: number;
	refresh: true;
	sub: string;
}

type OAuthData = Pick<RESTPostOAuth2AccessTokenResult, 'access_token' | 'refresh_token'> &
	(Pick<RESTPostOAuth2AccessTokenResult, 'expires_in'> | { expires_at: string });

export function createAccessToken(res: Response, oauthData: OAuthData, user: Me): AccessTokenData {
	const iat = Math.floor(Date.now() / 1_000);

	const { access_token: discordAccessToken } = oauthData;
	const accessTokenData: AccessTokenData = {
		iat,
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

export function noopAccessToken(res: Response): void {
	res.setHeader(NewAccessTokenHeader, 'noop');
}

export function createRefreshToken(res: Response, oauthData: OAuthData, sub: string): RefreshTokenData {
	const now = Date.now();
	const iat = Math.floor(now / 1_000);

	const { access_token: discordAccessToken, refresh_token: discordRefreshToken } = oauthData;
	const discordAccessTokenExpiresAt =
		'expires_at' in oauthData ? oauthData.expires_at : new Date(now + oauthData.expires_in * 1_000).toISOString();

	const refreshTokenData: RefreshTokenData = {
		discordAccessToken,
		iat,
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
