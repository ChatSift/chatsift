/* eslint-disable n/callback-return */

import { claimGrantToken, decrypt, getContext, RefreshTokenCookie, verifyGrantToken } from '@chatsift/backend-core';
import type { GrantString, GrantTokenData } from '@chatsift/backend-core';
import type { AmaSessions } from '@chatsift/db';
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
	/**
	 * If true, reaching this middleware atomically claims (single-use-consumes) the grant token via
	 * `claimGrantToken` before the handler runs. Set this ONLY on the one route that performs the action a grant
	 * actually authorizes (`createAMA`) — routes that merely accept a grant to read data scoped to it while the
	 * page loads (`getAMAs`, `/v3/auth/me`, `getGuild`) must leave this unset. Those routes are hit (with the
	 * same token) well before the user submits anything; claiming there would burn the single-use link on page
	 * load instead of on the actual create.
	 */
	claimsGrant?: boolean;
	fallthrough: false;
	/**
	 * If set, a scoped one-time grant token (see `@chatsift/backend-core`'s `GRANTS`) matching one of these
	 * strings is accepted as an alternative to a full session, provided its `guildId` matches the `:guildId`
	 * route param. Opt-in only — routes that don't set this never run the grant fast-path.
	 */
	grants?: readonly GrantString[];
	isGlobalAdmin: false;
	/**
	 * If true, assumes `guildId` parameter is present and checks if the user can manage that guild.
	 * `'or-ama-guest'` additionally accepts anyone listed in the `:amaId` route param's session's
	 * `guest_ids` (see `ama_sessions.guest_ids`'s doc comment in schema.sql) as an alternative to
	 * being a manager — for AMA question-action routes that guests get scoped dashboard access to.
	 * Only ever set on routes with an `:amaId` param.
	 */
	isGuildManager: boolean | 'or-ama-guest';
}

type IsAuthedOptions = IsAuthedFallthrough | IsAuthedGlobalAdmin | IsAuthedNoGlobalAdmin;

/**
 * Tokens attached to `req.tokens` once auth succeeds (or, in the fallthrough case, once attempted).
 */
export interface AuthedTokens {
	access: AccessTokenData;
	refresh: RefreshTokenData;
}

/**
 * Cheap (no DB/Discord round trip), claim-only check for "does this request act as a manager of
 * `:guildId`" -- a grant-authed request always does (it's already scoped to one guild and one action),
 * otherwise it's the same admin/`adminGuilds` claim the full `isGuildManager` middleware checks, just
 * without that middleware's additional live guild-membership re-verification via `fetchMe`. Exported for
 * routes like `getAMAs.ts` that need to branch their own query on manager-vs-not rather than hard-gating
 * the whole route on it.
 */
export function isGuildManagerToken(req: {
	grant?: GrantTokenData;
	params: Record<string, string>;
	tokens?: { access: AccessTokenData };
}): boolean {
	if (req.grant) {
		return true;
	}

	const guildId = req.params['guildId'];
	if (!req.tokens || !guildId) {
		return false;
	}

	return getContext().env.ADMINS.has(req.tokens.access.sub) || req.tokens.access.grants.adminGuilds.includes(guildId);
}

export function isAuthed(options: IsAuthedFallthrough): [TypedMiddleware<{ tokens?: AuthedTokens }>];
export function isAuthed(
	options: IsAuthedGlobalAdmin | (IsAuthedNoGlobalAdmin & { isGuildManager: 'or-ama-guest' }),
): [TypedMiddleware<{ tokens: AuthedTokens }>, TypedMiddleware];
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
						req.logger.info('request successfully refreshed token');
					} catch (error) {
						req.logger.warn({ err: error }, 'error refreshing discord access token, invalidating login');
						noopAccessToken(res);
						noopRefreshToken(res);
						await next(fallthrough ? undefined : unauthorized('invalidated refresh token'));
						return;
					}
				}

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

					// Only the route that actually performs the grant's action claims it (see `claimsGrant`'s doc) --
					// read-only routes accepting the same grant (getAMAs, /v3/auth/me, getGuild) skip this
					// entirely, so loading the create page doesn't burn the link before the user submits.
					// Atomically claims the token (`SET ... NX`) rather than a check-then-later-consume: two
					// concurrent requests for the same `jti` race here, and only one can win the claim, so at
					// most one AMA gets created per link. The route handler releases the claim on failure (see
					// `createAMA.ts`) so a bad submission doesn't permanently burn the link.
					if (options.claimsGrant && !(await claimGrantToken(grantToken.jti))) {
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
				const decoded = jwt.verify(refreshTokenCookie, getContext().env.ENCRYPTION_KEY) as RefreshTokenData;
				if (!decoded.refresh) {
					req.logger.info('refresh token is actually access, ignoring as request has been tampered with');
					noopAccessToken(res);
					noopRefreshToken(res);
					await next(fallthrough ? undefined : unauthorized('malformed refresh token'));
					return;
				}

				// discordAccessToken/discordRefreshToken are encrypted (not just signed) at rest in the JWT -- see
				// createRefreshToken -- so every reader downstream of this point gets plaintext back and doesn't
				// need to know about the encryption at all.
				try {
					refreshToken = {
						...decoded,
						discordAccessToken: decrypt(decoded.discordAccessToken),
						discordRefreshToken: decrypt(decoded.discordRefreshToken),
					};
				} catch {
					// A session issued before this encryption was added carries these fields as plaintext, which
					// fails GCM auth-tag verification here -- re-thrown as a JsonWebTokenError so it falls into the
					// same "malformed, force a clean re-login" branch below as genuine tampering, instead of an
					// uncaught 500 on every pre-existing session's first request after deploy.
					throw new jwt.JsonWebTokenError('failed to decrypt refresh token payload');
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
					const decoded = jwt.verify(accessTokenHeader, getContext().env.ENCRYPTION_KEY) as AccessTokenData;
					// A grant token has no `refresh` field either, so without the explicit `kind` check it would
					// otherwise sail through this guard and be treated as a valid session access token.
					if (decoded.refresh || (decoded as Partial<GrantTokenData>).kind === 'grant') {
						req.logger.info('access token is a refresh or grant token, ignoring as request has been tampered with');
						noopAccessToken(res);
						noopRefreshToken(res);
						await next(fallthrough ? undefined : unauthorized('malformed access token'));
						return;
					}

					// We're good -- discordAccessToken is encrypted (not just signed) at rest in the JWT, see
					// createAccessToken, so decrypt it back to plaintext for every downstream reader. Same
					// pre-encryption-session handling as the refresh token block above.
					let decryptedAccessToken: string;
					try {
						decryptedAccessToken = decrypt(decoded.discordAccessToken);
					} catch {
						throw new jwt.JsonWebTokenError('failed to decrypt access token payload');
					}

					req.tokens = {
						access: { ...decoded, discordAccessToken: decryptedAccessToken },
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
		const allowAmaGuest = options.isGuildManager === 'or-ama-guest';

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

				const isManagerClaim =
					getContext().env.ADMINS.has(req.tokens.access.sub) || req.tokens.access.grants.adminGuilds.includes(guildId);

				if (isManagerClaim) {
					// Membership itself can't be bypassed by the admin claim -- an admin who isn't a member of
					// this guild still gets rejected here, same as a plain manager would (see NavGate.tsx's
					// mirrored comment on the frontend gate).
					const me = await fetchMe(req.tokens.access.discordAccessToken, req.logger, false);
					const guild = me.guilds.find((g) => g.id === guildId);

					if (!guild) {
						return next(forbidden('you need to be a member of this guild to access this resource'));
					}

					// eslint-disable-next-line require-atomic-updates
					req.guild = guild;
					return next();
				}

				// Not a manager -- the only other way in is being a configured guest of the specific AMA this
				// route is scoped to. Membership-independent by design: a guest might not be an OAuth member of
				// the guild at all (see `util/me.ts`'s `fetchMe` guest-guild synthesis for the frontend-facing
				// side of that).
				if (allowAmaGuest) {
					const amaId = req.params['amaId'];
					if (!amaId) {
						req.logger.warn('isGuildManager "or-ama-guest" invoked without an amaId param. this is a bug');
						return next(internal());
					}

					const [session] = await getContext().db<Pick<AmaSessions, 'guestIds' | 'guildId'>[]>`
						SELECT guild_id, guest_ids FROM ama_sessions WHERE id = ${amaId}
					`;

					if (session?.guildId === guildId && session.guestIds.includes(req.tokens.access.sub)) {
						return next();
					}
				}

				return next(forbidden('you need to be a manager of this guild to access this resource'));
			}),
		);
	}

	return middleware;
}
