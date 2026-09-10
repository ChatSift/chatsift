/* eslint-disable n/callback-return */

import { AppealsRefreshTokenCookie, getContext } from '@chatsift/backend-core';
import { unauthorized } from '@hapi/boom';
import { parseCookie } from 'cookie';
import jwt from 'jsonwebtoken';
import { defineMiddleware } from '../core/route.js';
import type { TypedMiddleware } from '../core/route.js';
import type { AppealsAccessTokenData, AppealsRefreshTokenData } from '../util/appealsTokens.js';
import {
	createAppealsAccessToken,
	createAppealsRefreshToken,
	noopAppealsAccessToken,
	noopAppealsRefreshToken,
} from '../util/appealsTokens.js';

declare module 'polka' {
	export interface Request {
		/**
		 * The signed-in appellant, attached by `isAppealsAuthed`. Deliberately a different property from
		 * `req.tokens`: nothing that reads a dashboard session can accidentally read an appeals one, and
		 * vice versa, without the mistake being visible at the property name.
		 */
		appellant?: { sub: string };
	}
}

/**
 * `unban.app`'s session guard, and a **separate middleware from `isAuthed` on purpose** (#232 §3).
 *
 * The tempting version of this is a `kind` check inside `isAuthed`, with the appeals routes added to
 * `NON_GUILD_SCOPED_ROUTES`. That is the dangerous version, and `core/server.ts`'s own comment says why: a
 * `/dashboard`-minted scoped session defaults to *allowed* on every `isAuthed` route, so putting appellant
 * routes on that list would make an appellant surface reachable by a moderator's link-minted credential the
 * moment somebody forgot one check. Two middlewares that share no code path cannot have that bug: `isAuthed`
 * only ever accepts `refresh_token`, this only ever accepts `appeals_refresh_token`, and neither writes the
 * property the other reads. `assertGuildScopedRouteGuard` never fires for these routes either, since it keys
 * off `isAuthed`'s own marker rather than on the presence of a `:guildId` param.
 *
 * Much smaller than `isAuthed` because an appeals session has no upstream to keep in step -- see
 * `util/appealsTokens.ts` on why there is no Discord credential in either token, and therefore no rotation,
 * no coalescing and no `invalid_grant` handling here.
 */
export function isAppealsAuthed(options: { fallthrough: true }): [TypedMiddleware<{ appellant?: { sub: string } }>];
export function isAppealsAuthed(options: { fallthrough: false }): [TypedMiddleware<{ appellant: { sub: string } }>];
export function isAppealsAuthed({ fallthrough }: { fallthrough: boolean }): TypedMiddleware<object>[] {
	return [
		defineMiddleware(async (req, res, next) => {
			async function reject(message: string): Promise<void> {
				noopAppealsAccessToken(res);
				noopAppealsRefreshToken(res);
				await next(fallthrough ? undefined : unauthorized(message));
			}

			const refreshTokenCookie = parseCookie(req.headers.cookie ?? '')[AppealsRefreshTokenCookie];
			if (!refreshTokenCookie) {
				// Nothing to invalidate, so only the access token is nooped -- a client holding a stale one drops
				// it rather than re-sending it forever.
				noopAppealsAccessToken(res);
				await next(fallthrough ? undefined : unauthorized('missing appeals session'));
				return;
			}

			let refreshToken: AppealsRefreshTokenData;
			try {
				const decoded = jwt.verify(refreshTokenCookie, getContext().env.ENCRYPTION_KEY) as AppealsRefreshTokenData;
				// Both halves matter. `refresh` rejects an access token replayed as a refresh cookie; `kind`
				// rejects a *dashboard* token replayed into this cookie, which is the crossing this whole
				// middleware exists to make impossible -- the two are signed with the same key, so the
				// discriminator is what tells them apart, not the signature.
				if (!decoded.refresh || decoded.kind !== 'appeals') {
					req.logger.info('appeals refresh cookie is not an appeals refresh token, treating as tampering');
					await reject('malformed appeals session');
					return;
				}

				refreshToken = decoded;
			} catch (error) {
				if (error instanceof jwt.TokenExpiredError) {
					req.logger.info('appeals refresh token expired');
					await reject('expired appeals session');
					return;
				}

				if (error instanceof jwt.JsonWebTokenError) {
					req.logger.info({ reason: error.message }, 'appeals refresh token failed verification');
					await reject('malformed appeals session');
					return;
				}

				throw error;
			}

			const accessTokenHeader = req.headers.authorization;
			if (accessTokenHeader) {
				let access: AppealsAccessTokenData | null = null;

				try {
					access = jwt.verify(accessTokenHeader, getContext().env.ENCRYPTION_KEY) as AppealsAccessTokenData;
				} catch (error) {
					// Expired is the ordinary case, five minutes into any session -- fall through to the remint
					// below. Anything else that verification can raise is tampering.
					if (error instanceof jwt.TokenExpiredError) {
						req.logger.info('appeals access token expired, reminting from the refresh cookie');
					} else if (error instanceof jwt.JsonWebTokenError) {
						req.logger.info('appeals access token malformed');
						await reject('malformed appeals session');
						return;
					} else {
						throw error;
					}
				}

				if (access) {
					if (access.refresh || access.kind !== 'appeals' || access.sub !== refreshToken.sub) {
						req.logger.info('appeals access token is mismatched with its refresh cookie, treating as tampering');
						await reject('malformed appeals session');
						return;
					}

					req.appellant = { sub: access.sub };
					await next();
					return;
				}
			}

			// Reminting both halves rather than only the access token keeps the cookie's 30 days sliding for an
			// appellant who keeps checking back, which is the access pattern this session is for.
			createAppealsAccessToken(res, refreshToken.sub);
			createAppealsRefreshToken(res, refreshToken.sub);

			req.appellant = { sub: refreshToken.sub };
			await next();
		}),
	];
}
