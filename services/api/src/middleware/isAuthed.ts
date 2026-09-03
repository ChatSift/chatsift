/* eslint-disable n/callback-return */

import {
	decrypt,
	getContext,
	isDashboardSessionLive,
	RefreshTokenCookie,
	revokeDashboardSession,
} from '@chatsift/backend-core';
import type { Logger } from '@chatsift/backend-core';
import { CookielessClientHeader } from '@chatsift/core';
import type { AmaSessions } from '@chatsift/db';
import { forbidden, internal, unauthorized } from '@hapi/boom';
import { parseCookie } from 'cookie';
import jwt from 'jsonwebtoken';
import type { Response } from 'polka';
import { IS_AUTHED_MARKER, IS_GUILD_MANAGER_MARKER } from '../core/isAuthedMarker.js';
import { defineMiddleware } from '../core/route.js';
import type { TypedMiddleware } from '../core/route.js';
import { isRejectedGrantDiscordError, isUnauthorizedDiscordError } from '../util/discordErrors.js';
import type { RefreshedOAuthData } from '../util/discordOAuthRefresh.js';
import { refreshDiscordAccessToken } from '../util/discordOAuthRefresh.js';
import type { Me, MeGuild } from '../util/me.js';
import { fetchMe, fetchMeForScopedSession } from '../util/me.js';
import type { RefreshTokenData, AccessTokenData, ScopedRefreshTokenData } from '../util/tokens.js';
import {
	createAccessToken,
	createRefreshToken,
	createScopedAccessToken,
	createScopedRefreshToken,
	noopAccessToken,
	noopRefreshToken,
} from '../util/tokens.js';

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
	/**
	 * If `false`, a guild-scoped `/dashboard` session (see `util/tokens.ts`'s `ScopedAccessTokenData`) is
	 * rejected with 403 even if it would otherwise pass `isGuildManager` for this exact guild -- for the one
	 * class of route where that must never be reachable from a link-minted session: `dashboard_grants` CRUD
	 * (`createGrant`/`deleteGrant`), since a scoped session using it could mint itself *permanent* dashboard
	 * access before its own 30-minute window runs out. Defaults to `true` (allowed) -- a scoped session is
	 * meant to behave like a normal session scoped to one guild everywhere else, so routes don't need to opt in
	 * one by one.
	 */
	allowScopedSession?: boolean;
	fallthrough: false;
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
 * `fetchMe`/`fetchMeForScopedSession` against whatever's embedded in a still-unexpired session access token --
 * dispatches on `access.kind` so every call site (the manager-claim re-verification below, `/v3/auth/me`) works
 * unchanged regardless of whether the session is a full OAuth login or a `/dashboard`-minted scoped one.
 *
 * For an OAuth session, that embedded discord access token can be dead well before the JWT wrapping it expires
 * (the user re-authorized elsewhere, revoked the app, or another session rotated the pair) -- same underlying
 * hazard `refresh` handles, but these call sites can't recover the way it does, since they don't own the
 * response's token lifecycle. Nooping the access token and 401ing makes the client drop its copy and retry, and
 * that retry lands in `refresh`, which is able to rotate. Letting the 401 propagate instead 500s the request for
 * as long as the session access token stays unexpired.
 */
export async function fetchMeForSession(
	access: AccessTokenData,
	logger: Logger,
	res: Response,
	force = false,
): Promise<Me> {
	if (access.kind === 'scoped') {
		return fetchMeForScopedSession(access.guildId, access.sub, logger, force);
	}

	try {
		return await fetchMe(access.discordAccessToken, logger, force);
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
		logger: Logger;
		params: Record<string, string>;
		tokens?: { access: AccessTokenData };
	},
	res: Response,
): Promise<boolean> {
	const guildId = req.params['guildId'];
	if (!req.tokens || !guildId) {
		return false;
	}

	// The global-admin bypass only applies to a real OAuth session -- a scoped `/dashboard` session's
	// `grants.adminGuilds` is always exactly `[guildId]` (see `ScopedAccessTokenData`'s doc comment) precisely
	// so its authority can never widen past the one guild it was minted for, even for a user who also happens
	// to be a global admin.
	const isManagerClaim =
		(req.tokens.access.kind === 'oauth' && getContext().env.ADMINS.has(req.tokens.access.sub)) ||
		req.tokens.access.grants.adminGuilds.includes(guildId);
	if (!isManagerClaim) {
		return false;
	}

	// Membership itself can't be bypassed by the admin claim -- same rule `isGuildManager: true` enforces
	// below.
	const me = await fetchMeForSession(req.tokens.access, req.logger, res);
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
			// See `CookielessClientHeader`'s doc comment: this caller forwards the session's cookies but drops
			// every cookie written back, which makes a discord refresh-token rotation performed on its behalf a
			// silent session-killer rather than a renewal. Read once here, acted on in `rotate` below -- it's the
			// only thing in this middleware that can't be redone by a later request.
			const isCookielessClient = req.headers[CookielessClientHeader.toLowerCase()] !== undefined;

			async function refreshOAuth(refreshToken: Extract<RefreshTokenData, { kind: 'oauth' }>): Promise<void> {
				// Redeems the refresh token for a new pair. Resolves to `null` once it has already responded --
				// a refresh token discord won't accept is the one case here that genuinely can't be recovered from
				// without the user logging in again.
				async function rotate(): Promise<RefreshedOAuthData | null> {
					if (isCookielessClient) {
						req.logger.info('declining to rotate a discord refresh token for a client that cannot store cookies');
						// Deliberately only the access token, never `noopRefreshToken`: nothing here says the session is
						// dead, only that *this* caller can't be the one to renew it. The access token is nooped so the
						// caller drops its cached copy of the expired one (`apps/website`'s `serverTokenCache`); the
						// refresh cookie is left exactly as it is for the browser to renew through directly.
						noopAccessToken(res);
						await next(fallthrough ? undefined : unauthorized('session refresh requires a cookie-capable client'));
						return null;
					}

					req.logger.info('refreshing discord access token');
					try {
						const rotated = await refreshDiscordAccessToken(refreshToken.discordRefreshToken, req.logger);
						req.logger.info('request successfully refreshed token');
						return rotated;
					} catch (error) {
						// The same rule the reuse path below applies to `fetchMe`, applied to the one call whose failure
						// used to cost a login outright: `invalid_grant` -- discord rejecting *this user's* refresh
						// token -- is the only unrecoverable case. Everything else leaves the session alone and
						// surfaces as a plain 5xx for the client to retry: a discord 5xx, a rate limit or a socket
						// error says nothing about the token, and `refreshDiscordAccessToken` drops its coalescing
						// entry on any failure, so a request that never reached discord hasn't spent the refresh
						// token either.
						//
						// `401 invalid_client` belongs firmly on that second branch, and deliberately so: it means
						// *this service's* credentials were refused, which is a deployment fault. Treating it as a
						// dead grant is precisely what #384 was -- the rotation call shipped without its
						// `client_id`/`client_secret` (see `util/discordOAuthRefresh.ts`), every attempt came back
						// `401`, and every session in the system was cleared a week after it was created. Do not
						// widen this back out to a status check.
						if (!isRejectedGrantDiscordError(error)) {
							req.logger.warn({ err: error }, 'discord token refresh failed transiently, leaving the session intact');
							throw error;
						}

						req.logger.warn({ err: error }, 'discord rejected the refresh token, invalidating login');
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

			/**
			 * A `/dashboard`-minted session's refresh: no Discord token dance, just (1) confirm the session
			 * hasn't been revoked (`/dashboard revoke`) or outlived its absolute 30-minute cap, (2) re-resolve
			 * `Me` straight from Discord (bypassing `ScopedMeStore`'s cache -- otherwise this "periodic
			 * re-verification" would just keep re-reading the same cached answer for the session's whole
			 * lifetime, since every read slides the cache's own TTL forward) to catch a `ManageGuild` revocation
			 * since the link was minted, then (3) remint a pair whose `expiresIn` is clamped to whatever remains
			 * of the absolute cap -- see `createScopedRefreshToken`'s doc comment for why that clamp is what
			 * makes the cap absolute rather than sliding.
			 */
			async function refreshScoped(refreshToken: ScopedRefreshTokenData): Promise<void> {
				async function invalidate(reason: string, boom: ReturnType<typeof unauthorized>): Promise<void> {
					req.logger.info({ reason }, 'invalidating scoped dashboard session');
					noopAccessToken(res);
					noopRefreshToken(res);
					await next(fallthrough ? undefined : boom);
				}

				const live = await isDashboardSessionLive(refreshToken.sid);
				if (!live || Date.now() >= new Date(refreshToken.absoluteExpiresAt).getTime()) {
					await invalidate('revoked or expired', unauthorized('dashboard session expired or was revoked'));
					return;
				}

				let me: Me;
				try {
					me = await fetchMeForScopedSession(refreshToken.guildId, refreshToken.sub, req.logger, true);
				} catch (error) {
					req.logger.warn({ err: error }, 'failed to re-resolve scoped dashboard session');
					await invalidate('re-resolve failed', unauthorized('dashboard session is no longer valid'));
					return;
				}

				if (!me.guilds[0]?.meCanManage) {
					await revokeDashboardSession(refreshToken.sid);
					await invalidate('lost manage-guild permission', unauthorized('you no longer manage this guild'));
					return;
				}

				const newAccessToken = createScopedAccessToken(res, {
					sub: refreshToken.sub,
					guildId: refreshToken.guildId,
					sid: refreshToken.sid,
				});
				const newRefreshToken = createScopedRefreshToken(res, {
					sub: refreshToken.sub,
					guildId: refreshToken.guildId,
					sid: refreshToken.sid,
					absoluteExpiresAt: refreshToken.absoluteExpiresAt,
				});

				// eslint-disable-next-line require-atomic-updates
				req.tokens = {
					access: newAccessToken,
					refresh: newRefreshToken,
				};

				await next();
			}

			async function refresh(refreshToken: RefreshTokenData): Promise<void> {
				if (refreshToken.kind === 'scoped') {
					return refreshScoped(refreshToken);
				}

				return refreshOAuth(refreshToken);
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

				if (decoded.kind === 'scoped') {
					// No discord credential embedded in a scoped refresh token -- nothing to decrypt.
					refreshToken = decoded;
				} else {
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
				}
			} catch (error) {
				if (error instanceof jwt.TokenExpiredError) {
					req.logger.info('refresh token expired');
					noopAccessToken(res);
					noopRefreshToken(res);
					await next(fallthrough ? undefined : unauthorized('expired refresh token'));
					return;
				} else if (error instanceof jwt.JsonWebTokenError) {
					// Not necessarily tampering, which is what this used to assume: a session minted before the
					// payload encryption landed (2026-08-05, #293) fails the decrypt above and is re-thrown into
					// this same branch, and those cookies live 30 days -- so for a month after that deploy this is
					// the *expected* path for anyone returning after a long enough absence, not an attack. The
					// underlying reason is logged so the two can still be told apart in production; the response
					// stays a 401 either way, since both genuinely require a fresh login.
					req.logger.info({ reason: error.message }, 'refresh token failed verification, forcing a re-login');
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
					// A dashboard-link token has no `refresh` field either, so without the explicit `kind` check it
					// would otherwise sail through this guard and be treated as a valid session access token. A
					// `kind` mismatch against the refresh cookie (e.g. a scoped access token paired with an oauth
					// refresh cookie) can't happen from a genuine pair -- both are always minted together -- so
					// it's treated the same as tampering.
					if (
						decoded.refresh ||
						(decoded as { kind?: string }).kind === 'dashboard-link' ||
						decoded.kind !== refreshToken.kind
					) {
						req.logger.info(
							'access token is a refresh/link token or mismatched with the refresh token, ignoring as request has been tampered with',
						);
						noopAccessToken(res);
						noopRefreshToken(res);
						await next(fallthrough ? undefined : unauthorized('malformed access token'));
						return;
					}

					if (decoded.kind === 'scoped') {
						req.tokens = { access: decoded, refresh: refreshToken };
					} else {
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
					}

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
				// Make sure the refresh token is rotated -- oauth sessions only. A scoped session's cookie
				// already carries the correct clamped expiry from the last mint/rotation, and re-touching it
				// here on every request (rather than only on the periodic rotation in `refreshScoped`) would
				// turn the absolute 30-minute cap into a sliding one.
				if (req.tokens.refresh.kind === 'oauth') {
					req.tokens.refresh = createRefreshToken(
						res,
						{
							access_token: req.tokens.refresh.discordAccessToken,
							refresh_token: req.tokens.refresh.discordRefreshToken,
							expires_at: req.tokens.refresh.discordAccessTokenExpiresAt,
						},
						req.tokens.access.sub,
					);
				}

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

				// A scoped `/dashboard` session is denied outright, regardless of whether the acting user is
				// also a global admin -- global-admin routes are never guild-scoped, so there's no sense in
				// which a session minted for one guild should reach them.
				if (req.tokens?.access.kind === 'scoped') {
					return next(forbidden('global admin routes are not available to a /dashboard session'));
				}

				if (!getContext().env.ADMINS.has(req.tokens?.access?.sub ?? '')) {
					return next(forbidden('you need to be a global admin to access this resource'));
				}

				await next();
			}),
		);
	}

	if (!options.fallthrough && !options.isGlobalAdmin && options.allowScopedSession === false) {
		middleware.push(
			defineMiddleware(async (req, _, next) => {
				if (req.tokens?.access.kind === 'scoped') {
					return next(forbidden('this action is not available via a /dashboard session'));
				}

				await next();
			}),
		);
	}

	if (!options.fallthrough && !options.isGlobalAdmin && options.isGuildManager) {
		const allowAmaGuest = options.isGuildManager === 'or-ama-guest';

		const guildManagerMiddleware = defineMiddleware(async (req, res, next) => {
			if (!req.tokens) {
				req.logger.warn('isGuildManager invoked without a user. this is a bug');
				return next(internal());
			}

			const guildId = req.params['guildId'];
			if (!guildId) {
				req.logger.warn('isGuildManager invoked without a guildId param. this is a bug');
				return next(internal());
			}

			// See `isGuildManagerToken`'s doc comment on this same line -- the global-admin bypass never
			// applies to a scoped session, only an OAuth one.
			const isManagerClaim =
				(req.tokens.access.kind === 'oauth' && getContext().env.ADMINS.has(req.tokens.access.sub)) ||
				req.tokens.access.grants.adminGuilds.includes(guildId);

			if (isManagerClaim) {
				// Membership itself can't be bypassed by the admin claim -- an admin who isn't a member of
				// this guild still gets rejected here, same as a plain manager would (see NavGate.tsx's
				// mirrored comment on the frontend gate).
				const me = await fetchMeForSession(req.tokens.access, req.logger, res);
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
		});

		Reflect.set(guildManagerMiddleware, IS_GUILD_MANAGER_MARKER, true);
		middleware.push(guildManagerMiddleware);
	}

	for (const mw of middleware) {
		Reflect.set(mw, IS_AUTHED_MARKER, true);
	}

	return middleware;
}
