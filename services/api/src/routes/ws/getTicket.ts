import { createWsTicket, getContext } from '@chatsift/backend-core';
import { amaQuestionsChannel } from '@chatsift/core';
import type { AmaSessions } from '@chatsift/db';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';

export interface GetWsTicketResult {
	ticket: string;
}

/**
 * Mints a short-lived WS gateway ticket (`@chatsift/backend-core`'s `wsTicket.ts`) from a normal, cookie-backed
 * session request -- the dashboard calls this over regular `fetch` (where the existing session auth works fine)
 * before opening the actual `WebSocket`, since a browser `WebSocket` handshake can't carry the session's
 * `Authorization` header the way every other authed route does.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/ws/ticket',
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: false,
	}),
	async handler(req, res): Promise<GetWsTicketResult> {
		const access = req.tokens!.access;

		// AMA guest access never shows up in `grants.adminGuilds` (it isn't a `meCanManage` grant -- see
		// `WsTicketData.channels`), so without this a guest opens a perfectly valid socket whose every
		// `subscribe` frame is then silently dropped by the gateway. Resolved straight from the source of
		// truth `isAuthed`'s `'or-ama-guest'` path uses rather than via `fetchMeForSession`, which would drag
		// in a Discord round trip this route has no other need for.
		//
		// A scoped `/dashboard` session is confined to the guild it was minted for, the same way its
		// `adminGuilds` always is (`util/tokens.ts`'s `ScopedAccessTokenData`) -- otherwise a link-minted
		// session would pick up realtime for a guest AMA in some unrelated guild.
		const db = getContext().db;
		const guestSessions = await db<Pick<AmaSessions, 'guildId' | 'id'>[]>`
			SELECT id, guild_id FROM ama_sessions
			WHERE ${access.sub} = ANY(guest_ids)
			${access.kind === 'scoped' ? db`AND guild_id = ${access.guildId}` : db``}
		`;

		const ticket = createWsTicket({
			sub: access.sub,
			adminGuilds: access.grants.adminGuilds,
			channels: guestSessions.map((session) => amaQuestionsChannel(session.guildId, session.id)),
			isAdmin: getContext().env.ADMINS.has(access.sub),
		});

		// This is a bearer credential (short-lived, but still) -- must never be cached by a shared/intermediate cache.
		res.setHeader('Cache-Control', 'no-store');

		return { ticket };
	},
});
