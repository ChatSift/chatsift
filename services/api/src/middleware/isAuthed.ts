/* eslint-disable n/callback-return */

import type { RESTPostOAuth2AccessTokenResult } from '@discordjs/core';
import { forbidden, internal, unauthorized } from '@hapi/boom';
import cookie from 'cookie';
import jwt from 'jsonwebtoken';
import type { Middleware } from 'polka';
import { context } from '../context.js';
import { discordAPIOAuth } from '../util/discordAPI.js';
import type { MeGuild } from '../util/me.js';
import { fetchMe } from '../util/me.js';
import type { RefreshTokenData, AccessTokenData } from '../util/tokens.js';
import { createAccessToken, createRefreshToken, noopAccessToken, noopRefreshToken } from '../util/tokens.js';

declare module 'polka' {
	export interface Request {
		guild?: MeGuild;
		tokens?: {
			access: AccessTokenData;
			refresh: RefreshTokenData;
		};
	}
}

interface IsAuthedFallthrough {
	/**
	 * Attempts to authenticate the user, but doesn't 4xx fail if they aren't. Useful for routes where we *don't* want an
	 * authed user, or where authed status is optional but we might want to know what user it is if they are authed
	 */
	fallthrough: true;
	isGlobalAdmin: false;
}

interface IsAuthedGlobalAdmin {
	fallthrough: false;
	/**
	 * Checks if the user is a global admin after authing successfully
	 */
	isGlobalAdmin: true;
}

interface IsAuthedNoGlobalAdmin {
	fallthrough: false;
	isGlobalAdmin: false;
	/**
	 * If true, assumes `guildId` parameter is present and checks if the user can manage that guild
	 */
	isGuildManager: boolean;
}

type IsAuthedOptions = IsAuthedFallthrough | IsAuthedGlobalAdmin | IsAuthedNoGlobalAdmin;

export function isAuthed(options: IsAuthedOptions): Middleware[] {
	const { fallthrough, isGlobalAdmin } = options;

	const middleware: Middleware[] = [
		async (req, res, next) => {
			async function refresh(refreshToken: RefreshTokenData): Promise<void> {
				// To ensure our discord access tokens are always up to date without any complex logic, we refresh it here
				// if the token doesn't have ~7 minutes left on it (since our access tokens last 5)
				let oauthData: Pick<RESTPostOAuth2AccessTokenResult, 'access_token' | 'expires_in' | 'refresh_token'>;

				const expiresAt = new Date(refreshToken.discordAccessTokenExpiresAt).getTime();
				if (expiresAt >= Date.now() + 7 * 60 * 1_000) {
					context.logger.info('discord access token is still valid for enough time, no need to refresh it');
					oauthData = {
						access_token: refreshToken.discordAccessToken,
						refresh_token: refreshToken.discordRefreshToken,
						expires_in: (expiresAt - Date.now()) / 1_000,
					};
				} else {
					context.logger.info('refreshing discord access token');
					try {
						oauthData = await discordAPIOAuth.oauth2.refreshToken({
							grant_type: 'refresh_token',
							refresh_token: refreshToken.discordRefreshToken,
						});
					} catch (error) {
						context.logger.warn({ err: error }, 'error refreshing discord access token, invalidating login');
						noopAccessToken(res);
						noopRefreshToken(res);
						await next(fallthrough ? undefined : unauthorized('invalidated refresh token'));
						return;
					}
				}

				context.logger.info('request successfully refreshed token');

				// We're good, rotate things
				const me = await fetchMe(oauthData.access_token);
				const newAccessToken = createAccessToken(res, oauthData, me);
				const newRefreshToken = createRefreshToken(res, oauthData, me.id);

				req.tokens = {
					access: newAccessToken,
					refresh: newRefreshToken,
				};

				await next();
			}

			const cookies = cookie.parse(req.headers.cookie ?? '');
			const refreshTokenCookie = cookies['refresh_token'];
			// No refresh token, no shot the user is authed
			if (!refreshTokenCookie) {
				// Noop the access token as well if one is set
				noopAccessToken(res);
				await next(fallthrough ? undefined : unauthorized('expired or missing access token and missing refresh token'));

				return;
			}

			let refreshToken: RefreshTokenData;
			try {
				// Verify the JWT refresh token
				refreshToken = jwt.verify(refreshTokenCookie, context.env.ENCRYPTION_KEY) as RefreshTokenData;
				if (!refreshToken.refresh) {
					context.logger.info('refresh token is actually access, ignoring as request has been tampered with');
					noopAccessToken(res);
					noopRefreshToken(res);
					await next(fallthrough ? undefined : unauthorized('malformed refresh token'));
					return;
				}
			} catch (error) {
				if (error instanceof jwt.TokenExpiredError) {
					context.logger.info('refresh token expired');
					noopAccessToken(res);
					noopRefreshToken(res);
					await next(fallthrough ? undefined : unauthorized('expired refresh token'));
					return;
				} else if (error instanceof jwt.JsonWebTokenError) {
					context.logger.info('refresh token malformed');
					// Likely tampering.
					noopAccessToken(res);
					noopRefreshToken(res);
					await next(fallthrough ? undefined : unauthorized('malformed refresh token'));
					return;
				} else {
					throw error;
				}
			}

			// Check the JWT access token, always sent via header and not cookie
			const accessTokenHeader = req.headers.authorization;
			if (accessTokenHeader) {
				context.logger.info('request has access token');
				try {
					// Verify the JWT access token
					const accessToken = jwt.verify(accessTokenHeader, context.env.ENCRYPTION_KEY) as AccessTokenData;
					if (accessToken.refresh) {
						context.logger.info('access token is a refresh token, ignoring as request has been tampered with');
						noopAccessToken(res);
						noopRefreshToken(res);
						await next(fallthrough ? undefined : unauthorized('malformed access token'));
						return;
					}

					// We're good
					req.tokens = {
						access: accessToken,
						refresh: refreshToken,
					};

					context.logger.info({ userId: req.tokens.access?.sub }, 'request is authed via JWT');
				} catch (error) {
					if (error instanceof jwt.TokenExpiredError) {
						context.logger.info('access token expired');
						// If it is expired, we can try to use the refresh token
						await refresh(refreshToken);
						return;
					} else if (error instanceof jwt.JsonWebTokenError) {
						context.logger.info('access token malformed');
						// Don't bother with refreshes if the token is malformed. Likely tampering.
						noopAccessToken(res);
						noopRefreshToken(res);
						return next(fallthrough ? undefined : unauthorized('malformed access token'));
					} else {
						throw error;
					}
				}
			}

			if (req.tokens) {
				// Make sure the refresh token is rotated
				req.tokens.refresh = createRefreshToken(
					res,
					{
						access_token: req.tokens.refresh.discordAccessToken,
						refresh_token: req.tokens.refresh.discordRefreshToken,
						expires_at: req.tokens.refresh.discordAccessTokenExpiresAt,
					},
					req.tokens.access.sub,
				);

				await next();
			} else {
				// No access token, try refresh token if we can
				await refresh(refreshToken);
			}
		},
	];

	if (isGlobalAdmin) {
		middleware.push(async (req, _, next) => {
			if (!req.tokens) {
				context.logger.warn('isGlobalAdmin invoked without a user. this is a bug');
			}

			if (!context.env.ADMINS.has(req.tokens?.access?.sub ?? '')) {
				return next(forbidden('you need to be a global admin to access this resource'));
			}

			await next();
		});
	}

	if (!options.fallthrough && !options.isGlobalAdmin && options.isGuildManager) {
		middleware.push(async (req, _, next) => {
			if (!req.tokens) {
				context.logger.warn('isGuildManager invoked without a user. this is a bug');
				return next(internal());
			}

			const guildId = req.params['guildId'];
			if (!guildId) {
				context.logger.warn('isGuildManager invoked without a guildId param. this is a bug');
				return next(internal());
			}

			const me = await fetchMe(req.tokens.access.discordAccessToken, false);
			const guild = me.guilds.find((g) => g.id === guildId);

			if (!guild) {
				return next(forbidden('you need to be a member of this guild to access this resource'));
			}

			// eslint-disable-next-line require-atomic-updates
			req.guild = guild;

			if (context.env.ADMINS.has(req.tokens.access.sub)) {
				// Admin bypass
				return next();
			}

			if (!req.tokens.access.grants.adminGuilds.includes(guildId)) {
				return next(forbidden('you need to be a manager of this guild to access this resource'));
			}

			await next();
		});
	}

	return middleware;
}
