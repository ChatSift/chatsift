import { createWsTicket, getContext } from '@chatsift/backend-core';
import { amaPublicAnswersChannel } from '@chatsift/core';
import type { AmaSessions } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';

const paramsSchema = z.object({
	shareToken: z.string().min(1),
});

export interface PublicWsTicketResult {
	ticket: string;
}

/**
 * Unauthenticated counterpart to `routes/ws/getTicket.ts`, for the public answers page (#323). That page has no
 * session to mint a ticket from -- knowing the share token *is* the authorization, same as `publicAnswers.ts`
 * itself -- so this trades a valid token for a ticket that authorizes exactly one channel and nothing else:
 * no `adminGuilds`, no admin bypass, just `amaPublicAnswersChannel` for the AMA that token resolves to.
 *
 * Separate from `publicAnswers.ts` rather than folded into its response because tickets live 60 seconds and the
 * client re-mints on every (re)connect (`apps/website/src/api/ws.ts`), while the answers response is a
 * long-lived TanStack Query cache entry -- a ticket riding along on it would be expired by the first reconnect.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/ama/public/:shareToken/ws-ticket',
	schema: {
		params: paramsSchema,
	},
	async handler(req, res): Promise<PublicWsTicketResult> {
		const { shareToken } = req.params;

		const [session] = await getContext().db<Pick<AmaSessions, 'id'>[]>`
			SELECT id FROM ama_sessions WHERE share_token = ${shareToken}
		`;

		if (!session) {
			// Same message `publicAnswers.ts` uses for an unknown token -- an invalid share link and a deleted
			// AMA are indistinguishable to the viewer either way.
			throw notFound('AMA not found');
		}

		const ticket = createWsTicket({
			sub: `public:${session.id}`,
			adminGuilds: [],
			channels: [amaPublicAnswersChannel(session.id)],
			isAdmin: false,
		});

		// This is a bearer credential (short-lived, but still) -- must never be cached by a shared/intermediate cache.
		res.setHeader('Cache-Control', 'no-store');

		return { ticket };
	},
});
