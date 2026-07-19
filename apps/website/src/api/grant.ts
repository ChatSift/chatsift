'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

export interface GrantAuth {
	grant: string;
	guildId: string;
	sub: string;
	/**
	 * Raw JWT — passed as `FetchOptions.authToken` to `apiFetch`, never stored anywhere.
	 */
	token: string;
}

interface DecodedGrantPayload {
	grant?: string;
	guildId?: string;
	kind?: string;
	sub?: string;
}

/**
 * Only this exact route accepts a grant token in place of a session — restricting the check to it (rather than
 * treating any `?token=` anywhere in the dashboard as a grant) matters for more than tidiness: `useGrantAuth`'s
 * decode below is NOT cryptographic verification (it can't be, this runs in the browser with no access to
 * `ENCRYPTION_KEY`), so an unscoped check would let a forged `token` param on an unrelated dashboard route flip
 * `NavGateProvider`/`NavGateCheck`'s client-side gates for that route too. Scoping to this one path keeps that
 * blast radius at zero — every real authorization decision still happens server-side in `isAuthed`, which does
 * verify the signature, regardless of what this hook decides to render.
 */
const GRANT_ROUTE = /^\/dashboard\/(?<guildId>\d+)\/ama\/amas\/new\/?$/;

function decodeGrantPayload(token: string): DecodedGrantPayload | null {
	try {
		const [, payload] = token.split('.');
		if (!payload) {
			return null;
		}

		return JSON.parse(atob(payload)) as DecodedGrantPayload;
	} catch {
		return null;
	}
}

/**
 * Reads the one-time grant token from the `?token=` query param on `/dashboard/:guildId/ama/amas/new` and decodes
 * its shape client-side — this is NOT verification, the API re-verifies the JWT signature on every request. It
 * only drives what the frontend renders (dashboard chrome in a read-only state, the create form authed via the
 * token instead of a session) ahead of the first real request confirming the token is actually valid. Returns
 * `null` outside that one route, or when the token is missing/malformed.
 *
 * The token itself is never written to `accessTokenAtom` or any cookie — it's threaded per-request via
 * `apiFetch`'s `authToken` option instead, so the grant flow can never touch the caller's real session.
 */
export function useGrantAuth(): GrantAuth | null {
	const pathname = usePathname();
	const token = useSearchParams().get('token');

	return useMemo(() => {
		const routeMatch = GRANT_ROUTE.exec(pathname);
		if (!routeMatch || !token) {
			return null;
		}

		const payload = decodeGrantPayload(token);
		if (!payload) {
			return null;
		}

		if (payload.kind !== 'grant' || !payload.sub || !payload.guildId || !payload.grant) {
			return null;
		}

		// A mismatch here can't happen from a genuine link (the bot mints the token for the exact same guild
		// it embeds in the URL) -- treat it the same as "no grant" and let the page fall back to the normal
		// session flow rather than rendering as authorized for a guild the token doesn't actually cover.
		if (payload.guildId !== routeMatch.groups!['guildId']) {
			return null;
		}

		return { token, sub: payload.sub, guildId: payload.guildId, grant: payload.grant };
	}, [pathname, token]);
}
