import { getContext } from '@chatsift/backend-core';
import type { CategoriesId, TicketPanelCategories, TicketPanels, TicketPanelsId } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface TicketPanelWithCategories extends TicketPanels {
	categoryIds: CategoriesId[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/panels',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<TicketPanelWithCategories[]> {
		const { guildId } = req.params;
		const db = getContext().db;

		const panels = await db<TicketPanels[]>`
			SELECT * FROM ticket_panels WHERE guild_id = ${guildId} ORDER BY id
		`;

		const panelIds = panels.map((panel) => panel.id);
		const links = panelIds.length
			? await db<TicketPanelCategories[]>`
					SELECT * FROM ticket_panel_categories WHERE ticket_panel_id IN ${db(panelIds)}
				`
			: [];

		const categoryIdsByPanel = new Map<TicketPanelsId, CategoriesId[]>();
		for (const { ticketPanelId, categoryId } of links) {
			const existing = categoryIdsByPanel.get(ticketPanelId);
			if (existing) {
				existing.push(categoryId);
			} else {
				categoryIdsByPanel.set(ticketPanelId, [categoryId]);
			}
		}

		return panels.map((panel) => ({
			...panel,
			categoryIds: categoryIdsByPanel.get(panel.id) ?? [],
		}));
	},
});
