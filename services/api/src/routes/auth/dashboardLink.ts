import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import {
	claimDashboardLinkToken,
	DASHBOARD_SESSION_TTL_SECONDS,
	getContext,
	startDashboardSession,
	verifyDashboardLinkToken,
} from '@chatsift/backend-core';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { fetchMeForScopedSession } from '../../util/me.js';
import { createScopedAccessToken, createScopedRefreshToken } from '../../util/tokens.js';

const querySchema = z.object({
	token: z.string(),
});

type DashboardLinkError = 'expired' | 'forbidden' | 'unavailable' | 'used';

/**
 * Exchanges a `/dashboard`-minted link token (`?token=`, see `commands/dashboard.ts` on every bot) for a
 * guild-scoped session, then 302s to a clean dashboard URL with no token in it -- unlike the one-time grant
 * tokens this replaces, which stayed in the dashboard URL's query string for the whole visit. Deliberately not
 * behind `isAuthed`: this request carries no session at all yet, and the link token is single-use, so there's
 * nothing for a normal auth check to add here.
 *
 * Any prior session cookie in this browser is unconditionally overwritten by the scoped pair below -- the bot
 * command's reply copy says as much, since there's never a reason to use a `/dashboard` link while already
 * logged in normally.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/auth/dashboard',
	schema: {
		query: querySchema,
	},
	async handler(req, res) {
		// This response either sets a session cookie or (on failure) reveals nothing sensitive, but it's still a
		// bearer-credential-issuing endpoint -- must never be served from a shared/intermediate cache.
		res.setHeader('Cache-Control', 'no-store');

		function bounce(error: DashboardLinkError): void {
			const url = new URL('/dashboard', getContext().FRONTEND_URL);
			url.searchParams.set('dashboard_link_error', error);
			res.redirect(url.toString());
			res.end();
		}

		const link = verifyDashboardLinkToken(req.query.token);
		if (!link) {
			bounce('expired');
			return;
		}

		if (!(await claimDashboardLinkToken(link.jti))) {
			bounce('used');
			return;
		}

		// Re-verified here, not trusted from whenever the command minted the link -- the user's roles or the
		// bot's presence in the guild can both have changed in the (short, but nonzero) time since. Wrapped so
		// any failure here (guild/member gone, discord outage) still bounces the browser back to a friendly
		// dashboard error instead of leaking a raw JSON error out of what's otherwise an all-redirects flow.
		let me: Awaited<ReturnType<typeof fetchMeForScopedSession>>;
		try {
			me = await fetchMeForScopedSession(link.guildId, link.sub, req.logger, true);
		} catch (error) {
			req.logger.warn({ err: error }, 'failed to resolve identity while exchanging a /dashboard link');
			bounce('unavailable');
			return;
		}

		if (!me.guilds[0]?.meCanManage) {
			bounce('forbidden');
			return;
		}

		const sid = randomUUID();
		const absoluteExpiresAt = new Date(Date.now() + DASHBOARD_SESSION_TTL_SECONDS * 1_000).toISOString();

		await startDashboardSession(sid, { sub: link.sub, guildId: link.guildId });

		createScopedAccessToken(res, { sub: link.sub, guildId: link.guildId, sid });
		createScopedRefreshToken(res, { sub: link.sub, guildId: link.guildId, sid, absoluteExpiresAt });

		res.redirect(new URL(`/dashboard/${link.guildId}`, getContext().FRONTEND_URL).toString());
		res.end();
	},
});
