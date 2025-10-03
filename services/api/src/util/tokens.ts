import { NewAccessTokenHeader, PermissionsBitField } from '@chatsift/backend-core';
import type { APIUser, RESTPostOAuth2AccessTokenResult, Snowflake } from '@discordjs/core';
import { PermissionFlagsBits } from '@discordjs/core';
import jwt from 'jsonwebtoken';
import type { Response } from 'polka';
import { context } from '../context.js';
import { cookieWithDomain } from './constants.js';
import { discordAPIOAuth } from './discordAPI.js';

export interface TokenGrants {
	guildIds: string[];
}

export async function getGrants(discordAccessToken: string): Promise<TokenGrants> {
	const guilds = await discordAPIOAuth.users.getGuilds(
		{},
		{
			auth: {
				prefix: 'Bearer',
				token: discordAccessToken,
			},
		},
	);

	return {
		guildIds: guilds
			.filter((guild) => PermissionsBitField.has(BigInt(guild.permissions), PermissionFlagsBits.Administrator))
			.map((guild) => guild.id),
	};
}

export interface AccessTokenData {
	discordAccessToken: string;
	discordAccessTokenExpiresAt: string;
	discordRefreshToken: string;
	discordUser: APIUser;
	grants: TokenGrants;
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

export async function createAccessToken(res: Response, oauthData: OAuthData, user: APIUser): Promise<AccessTokenData> {
	const iat = Math.floor(Date.now() / 1_000);

	const { access_token: discordAccessToken, refresh_token: discordRefreshToken } = oauthData;
	const discordAccessTokenExpiresAt =
		'expires_at' in oauthData
			? oauthData.expires_at
			: new Date(Date.now() + oauthData.expires_in * 1_000).toISOString();
	const grants = await getGrants(discordAccessToken);

	const accessTokenData: AccessTokenData = {
		iat,
		refresh: false,
		sub: user.id,
		discordAccessToken,
		discordAccessTokenExpiresAt,
		discordRefreshToken,
		discordUser: user,
		grants,
	};

	const accessToken = jwt.sign(accessTokenData, context.env.ENCRYPTION_KEY, { expiresIn: 5 * 60 });
	res.setHeader(NewAccessTokenHeader, accessToken);

	return accessTokenData;
}

export function noopAccessToken(res: Response): void {
	res.setHeader(NewAccessTokenHeader, 'noop');
}

export function createRefreshToken(res: Response, oauthData: OAuthData, user: APIUser, nowOverride?: number): void {
	const now = nowOverride ?? Date.now();
	const iat = Math.floor(now / 1_000);

	const { access_token: discordAccessToken, refresh_token: discordRefreshToken } = oauthData;
	const discordAccessTokenExpiresAt =
		'expires_at' in oauthData
			? oauthData.expires_at
			: new Date(Date.now() + oauthData.expires_in * 1_000).toISOString();

	const refreshTokenData: RefreshTokenData = {
		iat,
		refresh: true,
		sub: user.id,
		discordAccessToken,
		discordRefreshToken,
		discordAccessTokenExpiresAt,
	};

	const refreshToken = jwt.sign(refreshTokenData, context.env.ENCRYPTION_KEY, { expiresIn: '30d' });
	res.cookie(
		'refresh_token',
		refreshToken,
		cookieWithDomain({
			expires: new Date(now + 30 * 24 * 60 * 60 * 1_000),
			path: '/',
			sameSite: 'lax',
			httpOnly: true,
			secure: context.env.IS_PRODUCTION,
		}),
	);
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
			secure: context.env.IS_PRODUCTION,
		}),
	);
}
