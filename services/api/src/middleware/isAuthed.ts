/* eslint-disable n/callback-return */

import { claimGrantToken, getContext, RefreshTokenCookie, verifyGrantToken } from '@chatsift/backend-core';
import type { GrantString, GrantTokenData } from '@chatsift/backend-core';
import type { RESTPostOAuth2AccessTokenResult } from '@discordjs/core';
import { forbidden, internal, unauthorized } from '@hapi/boom';
import { parseCookie } from 'cookie';
import jwt from 'jsonwebtoken';
import { defineMiddleware } from '../core/route.js';
import type { TypedMiddleware } from '../core/route.js';
import { discordAPIOAuth } from '../util/discordAPI.js';
import type { MeGuild } from '../util/me.js';
import { fetchMe } from '../util/me.js';
import type { RefreshTokenData, AccessTokenData } from '../util/tokens.js';
import { createAccessToken, createRefreshToken, noopAccessToken, noopRefreshToken } from '../util/tokens.js';

declare module 'polka' {
	export interface Request {
		/**
		 * Set instead of `tokens`/`guild` when the request authed via a scoped one-time grant token
		 * (see `grants` option below) rather than a full session — handlers opting into `grants` must not
		 * assume `tokens`/`guild` are populated.
		 */
		grant?: GrantTokenData;
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
	/**
	 * If set, a scoped one-time grant token (see `@chatsift/backend-core`'s `GRANTS`) matching one of these
	 * strings is accepted as an alternative to a full session, provided its `guildId` matches the `:guildId`
	 * route param. Opt-in only — routes that don't set this never run the grant fast-path.
	 */
	grants?: readonly GrantString[];
	isGlobalAdmin: false;
	/**
	 * If true, assumes `guildId` parameter is present and checks if the user can manage that guild
	 */
	isGuildManager: boolean;
}

type IsAuthedOptions = IsAuthedFallthrough | IsAuthedGlobalAdmin | IsAuthedNoGlobalAdmin;

/**
 * Tokens attached to `req.tokens` once auth succeeds (or, in the fallthrough case, once attempted).
 */
export interface AuthedTokens {
	access: AccessTokenData;
	refresh: RefreshTokenData;
}

export function isAuthed(options: IsAuthedFallthrough): [TypedMiddleware<{ tokens?: AuthedTokens }>];
export function isAuthed(options: IsAuthedGlobalAdmin): [TypedMiddleware<{ tokens: AuthedTokens }>, TypedMiddleware];
export function isAuthed(
	options: IsAuthedNoGlobalAdmin & { isGuildManager: true },
): [TypedMiddleware<{ tokens: AuthedTokens }>, TypedMiddleware<{ guild: MeGuild }>];
export function isAuthed(
	options: IsAuthedNoGlobalAdmin & { isGuildManager: false },
): [TypedMiddleware<{ tokens: AuthedTokens }>];
export function isAuthed(options: IsAuthedOptions): TypedMiddleware<object>[] {
	const { fallthrough, isGlobalAdmin } = options;

	const middleware: TypedMiddleware<object>[] = [
		defineMiddleware(async (req, res, next) => {
			async function refresh(refreshToken: RefreshTokenData): Promise<void> {
				// To ensure our discord access tokens are always up to date without any complex logic, we refresh it here
				// if the token doesn't have ~7 minutes left on it (since our access tokens last 5)
				let oauthData: Pick<RESTPostOAuth2AccessTokenResult, 'access_token' | 'expires_in' | 'refresh_token'>;

				const expiresAt = new Date(refreshToken.discordAccessTokenExpiresAt).getTime();
				if (expiresAt >= Date.now() + 7 * 60 * 1_000) {
					req.logger.info('discord access token is still valid for enough time, no need to refresh it');
					oauthData = {
						access_token: refreshToken.discordAccessToken,
						refresh_token: refreshToken.discordRefreshToken,
						expires_in: (expiresAt - Date.now()) / 1_000,
					};
				} else {
					req.logger.info('refreshing discord access token');
					try {
						oauthData = await discordAPIOAuth.oauth2.refreshToken({
							grant_type: 'refresh_token',
							refresh_token: refreshToken.discordRefreshToken,
						});
					} catch (error) {
						req.logger.warn({ err: error }, 'error refreshing discord access token, invalidating login');
						noopAccessToken(res);
						noopRefreshToken(res);
						await next(fallthrough ? undefined : unauthorized('invalidated refresh token'));
						return;
					}
				}

				req.logger.info('request successfully refreshed token');

				// We're good, rotate things
				const me = await fetchMe(oauthData.access_token, req.logger);
				const newAccessToken = createAccessToken(res, oauthData, me);
				const newRefreshToken = createRefreshToken(res, oauthData, me.id);

				// `req` is a per-request object, not shared mutable state -- the `req.logger` read above (crossing
				// the `fetchMe` await) is what trips this rule's static analysis, but there's no real race here.
				// eslint-disable-next-line require-atomic-updates
				req.tokens = {
					access: newAccessToken,
					refresh: newRefreshToken,
				};

				await next();
			}

			// Scoped grant-token fast path: entirely separate from, and prior to, the session-cookie logic
			// below. On a match it returns before touching any cookies or the access-token-refresh header, so a
			// grant request never mutates the caller's real session (the owner's hard isolation requirement for
			// #194) -- see also the frontend's mirrored `credentials: 'omit'` in `apiFetch`.
			if (!options.fallthrough && !options.isGlobalAdmin && options.grants?.length) {
				const grantToken = verifyGrantToken(req.headers.authorization);
				if (grantToken) {
					if (!options.grants.includes(grantToken.grant)) {
						await next(forbidden('grant not permitted for this route'));
						return;
					}

					// Routes without a `:guildId` param (e.g. `/v3/auth/me`) aren't scoped to a specific guild by
					// the URL at all -- there's nothing to compare against, so the handler uses `req.grant.guildId`
					// directly instead. Routes that DO have the param (getGuild, createAMA) still get the check.
					if (req.params['guildId'] !== undefined && grantToken.guildId !== req.params['guildId']) {
						await next(forbidden('grant guild mismatch'));
						return;
					}

					// Atomically claims the token (`SET ... NX`) rather than a check-then-later-consume: two concurrent
					// requests for the same `jti` race here, and only one can win the claim, so at most one AMA gets
					// created per link. The route handler releases the claim on failure (see `createAMA.ts`) so a
					// bad submission doesn't permanently burn the link.
					if (!(await claimGrantToken(grantToken.jti))) {
						await next(unauthorized('grant token already used'));
						return;
					}

					// `req` is a per-request object, not shared mutable state -- the `await claimGrantToken` above
					// crossing this assignment is what trips this rule's static analysis, but there's no real race.
					// eslint-disable-next-line require-atomic-updates
					req.grant = grantToken;
					await next();
					return;
				}
				// Not a grant token (or none provided) -- fall through to normal session auth below, so a
				// logged-in guild manager can still use grant-opted-in routes via their real session.
			}

			const cookies = parseCookie(req.headers.cookie ?? '');
			const refreshTokenCookie = cookies[RefreshTokenCookie];
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
				refreshToken = jwt.verify(refreshTokenCookie, getContext().env.ENCRYPTION_KEY) as RefreshTokenData;
				if (!refreshToken.refresh) {
					req.logger.info('refresh token is actually access, ignoring as request has been tampered with');
					noopAccessToken(res);
					noopRefreshToken(res);
					await next(fallthrough ? undefined : unauthorized('malformed refresh token'));
					return;
				}
			} catch (error) {
				if (error instanceof jwt.TokenExpiredError) {
					req.logger.info('refresh token expired');
					noopAccessToken(res);
					noopRefreshToken(res);
					await next(fallthrough ? undefined : unauthorized('expired refresh token'));
					return;
				} else if (error instanceof jwt.JsonWebTokenError) {
					req.logger.info('refresh token malformed');
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
				req.logger.info('request has access token');
				try {
					// Verify the JWT access token
					const accessToken = jwt.verify(accessTokenHeader, getContext().env.ENCRYPTION_KEY) as AccessTokenData;
					// A grant token has no `refresh` field either, so without the explicit `kind` check it would
					// otherwise sail through this guard and be treated as a valid session access token.
					if (accessToken.refresh || (accessToken as Partial<GrantTokenData>).kind === 'grant') {
						req.logger.info('access token is a refresh or grant token, ignoring as request has been tampered with');
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

					req.logger.info({ userId: req.tokens.access?.sub }, 'request is authed via JWT');
				} catch (error) {
					if (error instanceof jwt.TokenExpiredError) {
						req.logger.info('access token expired');
						// If it is expired, we can try to use the refresh token
						await refresh(refreshToken);
						return;
					} else if (error instanceof jwt.JsonWebTokenError) {
						req.logger.info('access token malformed');
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
		}),
	];

	if (isGlobalAdmin) {
		middleware.push(
			defineMiddleware(async (req, _, next) => {
				if (!req.tokens) {
					req.logger.warn('isGlobalAdmin invoked without a user. this is a bug');
				}

				if (!getContext().env.ADMINS.has(req.tokens?.access?.sub ?? '')) {
					return next(forbidden('you need to be a global admin to access this resource'));
				}

				await next();
			}),
		);
	}

	if (!options.fallthrough && !options.isGlobalAdmin && options.isGuildManager) {
		middleware.push(
			defineMiddleware(async (req, _, next) => {
				if (req.grant) {
					// The fast path above already validated the grant token's guild scope; routes that opt into
					// `grants` (getGuild, createAMA) don't read `req.guild`/`req.tokens`, so there's nothing left
					// to reconstruct here.
					return next();
				}

				if (!req.tokens) {
					req.logger.warn('isGuildManager invoked without a user. this is a bug');
					return next(internal());
				}

				const guildId = req.params['guildId'];
				if (!guildId) {
					req.logger.warn('isGuildManager invoked without a guildId param. this is a bug');
					return next(internal());
				}

				const me = await fetchMe(req.tokens.access.discordAccessToken, req.logger, false);
				const guild = me.guilds.find((g) => g.id === guildId);

				if (!guild) {
					return next(forbidden('you need to be a member of this guild to access this resource'));
				}

				// eslint-disable-next-line require-atomic-updates
				req.guild = guild;

				if (getContext().env.ADMINS.has(req.tokens.access.sub)) {
					// Admin bypass
					return next();
				}

				if (!req.tokens.access.grants.adminGuilds.includes(guildId)) {
					return next(forbidden('you need to be a manager of this guild to access this resource'));
				}

				await next();
			}),
		);
	}

	return middleware;
}
