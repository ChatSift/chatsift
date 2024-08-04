import { setTimeout } from 'node:timers';
import { parseRelativeTime } from '@chatsift/parse-relative-time';
import { Env, IDatabase, PermissionsBitField, type DiscordOAuth2User } from '@chatsift/service-core';
import {
	PermissionFlagsBits,
	Routes,
	API,
	type APIUser,
	type RESTGetAPICurrentUserGuildsResult,
	type Snowflake,
	type RESTPostOAuth2AccessTokenResult,
} from '@discordjs/core';
import { makeURLSearchParams } from '@discordjs/rest';
import type { CookieSerializeOptions } from 'cookie';
import type { FastifyReply } from 'fastify';
import { injectable } from 'inversify';
import jwt from 'jsonwebtoken';
import type { Selectable } from 'kysely';
import { appendCookie } from '../util/replyHelpers.js';

export interface AccessTokenData {
	iat: number;
	refresh: false;
	sub: string;
}

export interface RefreshTokenData {
	iat: number;
	refresh: true;
	sub: string;
}

export interface Token {
	expiration: Date;
	token: string;
}

export interface Credentials {
	access: Token;
	refresh: Token;
}

export interface APIUserWithGuilds extends APIUser {
	guilds: RESTGetAPICurrentUserGuildsResult;
}

export const SCOPES = ['identify', 'guilds'].join(' ');

@injectable()
export class Auth {
	private readonly cachedDiscordUser = new Map<string, APIUserWithGuilds>();

	public constructor(
		private readonly database: IDatabase,
		private readonly api: API,
	) {}

	public appendAuthCookies(reply: FastifyReply, credentials: Credentials): void {
		const options: CookieSerializeOptions = {
			expires: credentials.refresh.expiration,
			path: '/',
			sameSite: Env.NODE_ENV === 'prod' ? 'none' : 'strict',
			httpOnly: true,
			domain: Env.NODE_ENV === 'prod' ? '.automoderator.app' : undefined,
			secure: Env.NODE_ENV === 'prod',
		};

		appendCookie(reply, 'access_token', credentials.access.token, options);
		appendCookie(reply, 'refresh_token', credentials.refresh.token, options);
	}

	public appendInvalidatedAuthCookies(reply: FastifyReply): void {
		const options: CookieSerializeOptions = {
			expires: new Date(1_970),
			path: '/',
			sameSite: Env.NODE_ENV === 'prod' ? 'none' : 'strict',
			httpOnly: true,
			domain: Env.NODE_ENV === 'prod' ? '.automoderator.app' : undefined,
			secure: Env.NODE_ENV === 'prod',
		};

		appendCookie(reply, 'access_token', 'invalidated', options);
		appendCookie(reply, 'refresh_token', 'invalidated', options);
	}

	public createTokens(userId: Snowflake): Credentials {
		const iat = Math.floor(Date.now() / 1_000);

		const data = {
			sub: userId,
			iat,
		};

		const accessToken: AccessTokenData = {
			...data,
			refresh: false,
		};

		const refreshToken: RefreshTokenData = {
			...data,
			refresh: true,
		};

		const accessExpiresIn = parseRelativeTime('15m');
		const refreshExpiresIn = parseRelativeTime('7d');

		return {
			access: {
				token: jwt.sign(accessToken, Env.SECRET_SIGNING_KEY, { expiresIn: Math.floor(accessExpiresIn / 1_000) }),
				expiration: new Date(Date.now() + accessExpiresIn),
			},
			refresh: {
				token: jwt.sign(refreshToken, Env.SECRET_SIGNING_KEY, { expiresIn: Math.floor(refreshExpiresIn / 1_000) }),
				expiration: new Date(Date.now() + refreshExpiresIn),
			},
		};
	}

	public refreshTokens(accessToken: string, refreshToken: string): Credentials {
		const accessData = jwt.verify(accessToken, Env.SECRET_SIGNING_KEY, {
			ignoreExpiration: true,
		}) as AccessTokenData;

		const refreshData = jwt.verify(refreshToken, Env.SECRET_SIGNING_KEY) as RefreshTokenData;

		if (accessData.refresh || !refreshData.refresh) {
			throw new Error('invalid token(s)');
		}

		if (accessData.sub !== refreshData.sub) {
			throw new Error('unmatched token(s)');
		}

		return this.createTokens(accessData.sub);
	}

	public async verifyToken(token: string, ignoreExpiration = false): Promise<Selectable<DiscordOAuth2User>> {
		const data = jwt.verify(token, Env.SECRET_SIGNING_KEY, { ignoreExpiration }) as AccessTokenData;
		const user = await this.database.getDiscordOAuth2User(data.sub);

		if (!user) {
			throw new Error('invalid user despite the token signature being valid.');
		}

		return user;
	}

	public async fetchDiscordUser(discordAccessToken: string): Promise<APIUserWithGuilds> {
		if (this.cachedDiscordUser.has(discordAccessToken)) {
			return this.cachedDiscordUser.get(discordAccessToken)!;
		}

		// We use manual REST here because core doesn't really let me pass a bearer token
		const options = {
			auth: false,
			headers: {
				Authorization: `Bearer ${discordAccessToken}`,
			},
		};

		const user = (await this.api.rest.get(Routes.user('@me'), options)) as APIUser;
		const guildList = (await this.api.rest.get(Routes.userGuilds(), {
			query: makeURLSearchParams({ with_counts: true }),
			...options,
		})) as RESTGetAPICurrentUserGuildsResult;

		const guilds = guildList.filter((guild) =>
			PermissionsBitField.has(BigInt(guild.permissions), PermissionFlagsBits.Administrator),
		);

		const discordUser: APIUserWithGuilds = { ...user, guilds };
		this.cachedDiscordUser.set(discordAccessToken, discordUser);
		setTimeout(() => this.cachedDiscordUser.delete(discordAccessToken), parseRelativeTime('5m')).unref();

		return discordUser;
	}

	public async loginWithDiscord(
		discordUserId: string,
		data: RESTPostOAuth2AccessTokenResult,
	): Promise<Selectable<DiscordOAuth2User>> {
		const connectionData = {
			id: discordUserId,
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: new Date(Date.now() + data.expires_in * 1_000),
		};

		return this.database.upsertDiscordOAuth2User(connectionData);
	}
}
