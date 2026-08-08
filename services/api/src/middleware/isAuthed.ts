/* eslint-disable n/callback-return */

import { claimGrantToken, decrypt, getContext, RefreshTokenCookie, verifyGrantToken } from '@chatsift/backend-core';
import type { GrantString, GrantTokenData, Logger } from '@chatsift/backend-core';
import type { AmaSessions } from '@chatsift/db';
import { forbidden, internal, unauthorized } from '@hapi/boom';
import { parseCookie } from 'cookie';
import jwt from 'jsonwebtoken';
import type { Response } from 'polka';
import { defineMiddleware } from '../core/route.js';
import type { TypedMiddleware } from '../core/route.js';
import { isUnauthorizedDiscordError } from '../util/discordErrors.js';
import type { RefreshedOAuthData } from '../util/discordOAuthRefresh.js';
import { refreshDiscordAccessToken } from '../util/discordOAuthRefresh.js';
import type { Me, MeGuild } from '../util/me.js';
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
 * Claim-only fast path plus the same live guild-membership re-verification the full `isGuildManager`
 * middleware does via `fetchMe` -- a grant-authed request always counts as a manager (it's already
 * scoped to one guild and one action), but an admin/`adminGuilds` claim alone does NOT, since that claim
 * can go stale between token issuance and this request (guild left, admin status revoked). `fetchMe` is
 * cache-backed (see `MeStore`), so this stays cheap on the common case. Exported for routes like
 * `getAMAs.ts` that need to branch their own query on manager-vs-not rather than hard-gating the whole
 * route on it.
 */
/**
 * `fetchMe` against a discord access token carried inside a still-unexpired session access token.
 *
 * That embedded token can be dead well before the JWT wrapping it expires (the user re-authorized elsewhere,
 * revoked the app, or another session rotated the pair) -- same underlying hazard `refresh` handles, but these
 * call sites can't recover the way it does, since they don't own the response's token lifecycle. Nooping the
 * access token and 401ing makes the client drop its copy and retry, and that retry lands in `refresh`, which is
 * able to rotate. Letting the 401 propagate instead 500s the request for as long as the session access token
 * stays unexpired.
 */
export async function fetchMeForSession(
	discordAccessToken: string,
	logger: Logger,
	res: Response,
	force = false,
): Promise<Me> {
	try {
		return await fetchMe(discordAccessToken, logger, force);
	} catch (error) {
		if (!isUnauthorizedDiscordError(error)) {
			throw error;
		}

		logger.warn({ err: error }, 'session access token embeds a dead discord access token, forcing a re-auth');
		noopAccessToken(res);
		throw unauthorized('discord session is no longer valid');
	}
}

export async function isGuildManagerToken(
	req: {
		grant?: GrantTokenData;
		logger: Logger;
		params: Record<string, string>;
		tokens?: { access: AccessTokenData };
	},
	res: Response,
): Promise<boolean> {
	if (req.grant) {
		return true;
	}

	const guildId = req.params['guildId'];
	if (!req.tokens || !guildId) {
		return false;
	}

	const isManagerClaim =
		getContext().env.ADMINS.has(req.tokens.access.sub) || req.tokens.access.grants.adminGuilds.includes(guildId);
	if (!isManagerClaim) {
		return false;
	}

	// Membership itself can't be bypassed by the admin claim -- same rule `isGuildManager: true` enforces
	// below.
	const me = await fetchMeForSession(req.tokens.access.discordAccessToken, req.logger, res);
	return me.guilds.some((guild) => guild.id === guildId);
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
				// Redeems the refresh token for a new pair. Resolves to `null` once it has already responded --
				// a refresh token discord won't accept is the one case here that genuinely can't be recovered from
				// without the user logging in again.
				async function rotate(): Promise<RefreshedOAuthData | null> {
					req.logger.info('refreshing discord access token');
					try {
						const rotated = await refreshDiscordAccessToken(refreshToken.discordRefreshToken, req.logger);
						req.logger.info('request successfully refreshed token');
						return rotated;
					} catch (error) {
						req.logger.warn({ err: error }, 'error refreshing discord access token, invalidating login');
						noopAccessToken(res);
						noopRefreshToken(res);
						await next(fallthrough ? undefined : unauthorized('invalidated refresh token'));
						return null;
					}
				}

				let oauthData: RefreshedOAuthData | undefined;
				let me: Me | undefined;
				// Set only on the rotation path below, where the cookie has to be written before `/me` is called.
				let rotatedRefreshToken: RefreshTokenData | undefined;

				// To ensure our discord access tokens are always up to date without any complex logic, we refresh it here
				// if the token doesn't have ~7 minutes left on it (since our access tokens last 5)
				const expiresAt = new Date(refreshToken.discordAccessTokenExpiresAt).getTime();
				if (expiresAt >= Date.now() + 7 * 60 * 1_000) {
					req.logger.info('discord access token is still valid for enough time, no need to refresh it');
					const stored: RefreshedOAuthData = {
						access_token: refreshToken.discordAccessToken,
						refresh_token: refreshToken.discordRefreshToken,
						expires_in: (expiresAt - Date.now()) / 1_000,
					};

					try {
						me = await fetchMe(stored.access_token, req.logger);
						oauthData = stored;
					} catch (error) {
						// `discordAccessTokenExpiresAt` is our own bookkeeping, not something discord reconfirms per
						// request -- the token it describes can be dead long before that timestamp (the user
						// re-authorized from another browser, revoked the app, or a concurrent session rotated this
						// pair, since rotating invalidates the previous access token). Letting that propagate is what
						// made this a *sticky* failure rather than a one-off: nothing in this branch writes a cookie,
						// so the request 500s AND the next one re-reads the very same dead token out of the very same
						// cookie, repeating until real time drags `expiresAt` inside the window above -- up to a week,
						// since that's how long discord's access tokens live.
						//
						// A 401 specifically means "this access token is dead", which the refresh token below can
						// still fix, so fall through and rotate instead of failing. Anything else (5xx, rate limit,
						// network) says nothing about the token's validity and must not spend a rotation.
						if (!isUnauthorizedDiscordError(error)) {
							throw error;
						}

						req.logger.warn(
							{ err: error },
							'stored discord access token was rejected before its recorded expiry, rotating it',
						);
					}
				}

				if (!oauthData || !me) {
					const rotated = await rotate();
					if (!rotated) {
						return;
					}

					oauthData = rotated;
					// Committed to the cookie *before* the `/me` call below, unlike the reuse path above. Discord
					// invalidates the old refresh token the moment this rotation succeeds, so if `fetchMe` then threw
					// and we hadn't got here, the client would be left holding a refresh token that no longer works --
					// a forced logout caused by an unrelated blip, on a session we'd just successfully renewed.
					// `refreshToken.sub` rather than `me.id` (not fetched yet) since a rotation is always same-user.
					rotatedRefreshToken = createRefreshToken(res, oauthData, refreshToken.sub);
					me = await fetchMe(oauthData.access_token, req.logger);
				}

				const newAccessToken = createAccessToken(res, oauthData, me);
				const newRefreshToken = rotatedRefreshToken ?? createRefreshToken(res, oauthData, me.id);

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
			defineMiddleware(async (req, res, next) => {
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
					const me = await fetchMeForSession(req.tokens.access.discordAccessToken, req.logger, res);
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
