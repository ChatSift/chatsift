import { createWsTicket, getContext } from '@chatsift/backend-core';
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
	async handler(req): Promise<GetWsTicketResult> {
		const ticket = createWsTicket({
			sub: req.tokens!.access.sub,
			adminGuilds: req.tokens!.access.grants.adminGuilds,
			isAdmin: getContext().env.ADMINS.has(req.tokens!.access.sub),
		});

		return { ticket };
	},
});
