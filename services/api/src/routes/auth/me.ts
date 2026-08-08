import type { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { fetchMeForSession, isAuthed } from '../../middleware/isAuthed.js';
import type { Me } from '../../util/me.js';
import { queryWithFreshSchema } from '../../util/schemas.js';

export type { Me, MeGuild } from '../../util/me.js';

const querySchema = queryWithFreshSchema;
export type GetAuthMeQuery = z.input<typeof querySchema>;

export interface MeResponse extends Me {
	/**
	 * Absolute cutoff for a `/dashboard`-minted session (`ScopedRefreshTokenData.absoluteExpiresAt`), `null` for
	 * a normal OAuth session -- drives the frontend's limited-session banner.
	 */
	scopedExpiresAt: string | null;
	/**
	 * `'scoped'` for a session minted by the `/v3/auth/dashboard` link exchange rather than a full OAuth login --
	 * see `middleware/isAuthed.ts`'s `AccessTokenData`/`RefreshTokenData` discriminated unions.
	 */
	sessionKind: 'oauth' | 'scoped';
}

export default defineRoute({
	method: 'get',
	path: '/v3/auth/me',
	schema: {
		query: querySchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: false,
	}),
	async handler(req, res): Promise<MeResponse> {
		// `fetchMeForSession` rather than a bare `fetchMe`: this is the endpoint the dashboard's whole auth state
		// hangs off, so a session access token whose embedded discord token has since died has to come back as a
		// recoverable 401 (which drops the client's token and re-auths on the next request) rather than a 500.
		const me = await fetchMeForSession(req.tokens!.access, req.logger, res, req.query.force_fresh);

		return {
			...me,
			sessionKind: req.tokens!.access.kind,
			scopedExpiresAt: req.tokens!.refresh.kind === 'scoped' ? req.tokens!.refresh.absoluteExpiresAt : null,
		};
	},
});
