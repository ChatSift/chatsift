/* eslint-disable n/callback-return */

import type { RESTPostOAuth2AccessTokenResult } from '@discordjs/core';
import { forbidden, internal, unauthorized } from '@hapi/boom';
import cookie from 'cookie';
import jwt from 'jsonwebtoken';
import type { Middleware } from 'polka';
import { context } from '../context.js';
import { discordAPIOAuth } from '../util/discordAPI.js';
import type { RefreshTokenData, AccessTokenData } from '../util/tokens.js';
import { createAccessToken, createRefreshToken, noopAccessToken, noopRefreshToken } from '../util/tokens.js';

declare module 'polka' {
	export interface Request {
		user?: AccessTokenData;
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
			async function refresh(): Promise<void> {
				const cookies = cookie.parse(req.headers.cookie ?? '');
				const refresh = cookies['refresh_token'];
				// No refresh token, no shot the user is authed
				if (!refresh) {
					// Noop the access token as well
					noopAccessToken(res);
					await next(
						fallthrough ? undefined : unauthorized('expired or missing access token and missing refresh token'),
					);

					return;
				}

				let token;
				try {
					// Verify the JWT refresh token
					const data = jwt.verify(refresh, context.env.ENCRYPTION_KEY) as RefreshTokenData;
					if (!data.refresh) {
						context.logger.info('refresh token is actually access, ignoring as request has been tampered with');
						noopAccessToken(res);
						noopRefreshToken(res);
						await next(fallthrough ? undefined : unauthorized('malformed refresh token'));
						return;
					}

					token = data;
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

				// To ensure our discord access tokens are always up to date without any complex logic, we refresh it here
				// if the token doesn't have ~7 minutes left on it (since our access tokens last 5)
				let oauthData: Pick<RESTPostOAuth2AccessTokenResult, 'access_token' | 'expires_in' | 'refresh_token'>;

				const expiresAt = new Date(token.discordAccessTokenExpiresAt).getTime();
				if (expiresAt >= Date.now() + 7 * 60 * 1_000) {
					context.logger.info('discord access token is still valid for enough time, no need to refresh it');
					oauthData = {
						access_token: token.discordAccessToken,
						refresh_token: token.discordRefreshToken,
						expires_in: (expiresAt - Date.now()) / 1_000,
					};
				} else {
					context.logger.info('refreshing discord access token');
					try {
						oauthData = await discordAPIOAuth.oauth2.refreshToken({
							grant_type: 'refresh_token',
							refresh_token: token.discordRefreshToken,
						});
					} catch (error) {
						context.logger.warn({ err: error }, 'error refreshing discord access token, invalidating login');
						noopAccessToken(res);
						noopRefreshToken(res);
						await next(fallthrough ? undefined : unauthorized('invalidated refresh token'));
						return;
					}
				}

				const user = await discordAPIOAuth.users.getCurrent({
					auth: { token: oauthData.access_token, prefix: 'Bearer' },
				});

				context.logger.info('request successfully refreshed token');
				// We're good, rotate things
				const newAccessToken = await createAccessToken(res, oauthData, user);
				createRefreshToken(res, oauthData, user);

				// eslint-disable-next-line require-atomic-updates
				req.user = newAccessToken;
				await next();
			}

			// Check the JWT access token, always sent via header and not cookie
			const accessToken = req.headers.authorization;
			if (accessToken) {
				context.logger.info('request has access token');
				try {
					// Verify the JWT access token
					const data = jwt.verify(accessToken, context.env.ENCRYPTION_KEY) as AccessTokenData;
					if (data.refresh) {
						context.logger.info('access token is a refresh token, ignoring as request has been tampered with');
						noopAccessToken(res);
						noopRefreshToken(res);
						await next(fallthrough ? undefined : unauthorized('malformed access token'));
						return;
					}

					// We're good
					req.user = data;
					context.logger.info({ userId: req.user?.sub }, 'request is authed via JWT');
				} catch (error) {
					if (error instanceof jwt.TokenExpiredError) {
						context.logger.info('access token expired');
						// If it is expired, we can try to use the refresh token
						await refresh();
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

			if (req.user) {
				// Make sure the refresh token is rotated
				createRefreshToken(
					res,
					{
						access_token: req.user.discordAccessToken,
						refresh_token: req.user.discordRefreshToken,
						expires_at: req.user.discordAccessTokenExpiresAt,
					},
					req.user.discordUser,
				);
				await next();
			} else {
				// No access token, try refresh token if we can
				await refresh();
			}
		},
	];

	if (isGlobalAdmin) {
		middleware.push(async (req, _, next) => {
			if (!req.user) {
				context.logger.warn('isGlobalAdmin invoked without a user. this is a bug');
			}

			if (!context.env.ADMINS.has(req.user?.sub ?? '')) {
				return next(forbidden('you need to be a global admin to access this resource'));
			}

			await next();
		});
	}

	if (!options.fallthrough && !options.isGlobalAdmin && options.isGuildManager) {
		middleware.push(async (req, _, next) => {
			if (!req.user) {
				context.logger.warn('isGuildManager invoked without a user. this is a bug');
				return next(internal());
			}

			const guildId = req.params['guildId'];
			if (!guildId) {
				context.logger.warn('isGuildManager invoked without a guildId param. this is a bug');
				return next(internal());
			}

			if (context.env.ADMINS.has(req.user.sub)) {
				// Admin bypass
				return next();
			}

			if (!req.user.grants.guildIds.includes(guildId)) {
				return next(forbidden('you need to be a manager of this guild to access this resource'));
			}

			await next();
		});
	}

	return middleware;
}
