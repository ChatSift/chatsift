import { getContext } from '@chatsift/backend-core';
import type { TicketPanels, TicketPanelsId } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIModmail } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	panelId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as TicketPanelsId),
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/modmail/panels/:panelId',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req, res): Promise<void> {
		const { guildId, panelId } = req.params;

		const [deleted] = await getContext().db<TicketPanels[]>`
			DELETE FROM ticket_panels WHERE id = ${panelId} AND guild_id = ${guildId}
			RETURNING *
		`;

		if (!deleted) {
			throw notFound('ticket panel not found');
		}

		// Best-effort: the DB row is the source of truth, so a stale/already-deleted Discord message here isn't an
		// error worth surfacing -- mirrors the cleanup pattern in createPanel/createAMA.
		// eslint-disable-next-line promise/prefer-await-to-then
		void discordAPIModmail.channels.deleteMessage(deleted.channelId, deleted.messageId).catch(() => null);

		res.statusCode = 200;
		res.end();
	},
});
