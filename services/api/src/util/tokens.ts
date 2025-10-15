import { getContext, NewAccessTokenHeader } from '@chatsift/backend-core';
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

	const accessToken = jwt.sign(accessTokenData, getContext().env.ENCRYPTION_KEY, { expiresIn: 5 * 60 });
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

	const refreshToken = jwt.sign(refreshTokenData, getContext().env.ENCRYPTION_KEY, { expiresIn: '30d' });
	res.cookie(
		'refresh_token',
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
		'refresh_token',
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
