import { getContext } from '@chatsift/backend-core';
import type { Categories, TicketPanels, TicketPanelsId } from '@chatsift/db';
import type { RESTPostAPIChannelMessageJSONBody } from '@discordjs/core';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, badRequest, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIModmail } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { updatePanelBodySchema } from '../schemas.js';
import type { TicketPanelWithCategories } from './listPanels.js';

const bodySchema = updatePanelBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	panelId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as TicketPanelsId),
});

export type UpdatePanelBody = z.input<typeof bodySchema>;
export type UpdatePanelResult = TicketPanelWithCategories;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/modmail/panels/:panelId',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpdatePanelResult> {
		const data = req.body;
		const { guildId, panelId } = req.params;
		const db = getContext().db;

		const [existingPanel] = await db<TicketPanels[]>`
			SELECT * FROM ticket_panels WHERE id = ${panelId} AND guild_id = ${guildId}
		`;

		if (!existingPanel) {
			throw notFound('ticket panel not found');
		}

		if (data.categoryIds) {
			const categories = await db<Pick<Categories, 'id'>[]>`
				SELECT id FROM categories WHERE guild_id = ${guildId} AND id IN ${db(data.categoryIds)}
			`;

			if (categories.length !== data.categoryIds.length) {
				throw badRequest('one or more categoryIds do not belong to this guild');
			}
		}

		let panelJsonData = existingPanel.panelJsonData;
		if (data.panel ?? data.panel_raw) {
			const messageBodyBase: RESTPostAPIChannelMessageJSONBody = data.panel_raw ?? {
				embeds: [
					{
						// TODO: real constant
						color: 0x7289da, // blurple
						title: data.panel!.title,
						description: data.panel!.description,
					},
				],
			};

			try {
				await discordAPIModmail.channels.editMessage(existingPanel.channelId, existingPanel.messageId, {
					...messageBodyBase,
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									style: ButtonStyle.Primary,
									label: data.panel?.buttonLabel ?? 'Create Ticket',
									custom_id: 'modmail-create-ticket',
								},
							],
						},
					],
				});
			} catch (error) {
				if (error instanceof DiscordAPIError && error.status === 400 && data.panel_raw) {
					throw badData('invalid panel_raw data');
				}

				if (error instanceof DiscordAPIError && error.status === 404) {
					throw badData('panel message no longer exists on Discord; delete and recreate this panel');
				}

				throw error;
			}

			panelJsonData = JSON.stringify(messageBodyBase);
		}

		return db.begin(async (sql) => {
			const [panel] = await sql<TicketPanels[]>`
				UPDATE ticket_panels SET panel_json_data = ${panelJsonData} WHERE id = ${panelId}
				RETURNING *
			`;

			if (data.categoryIds) {
				await sql`DELETE FROM ticket_panel_categories WHERE ticket_panel_id = ${panelId}`;

				for (const categoryId of data.categoryIds) {
					await sql`
						INSERT INTO ticket_panel_categories (ticket_panel_id, category_id)
						VALUES (${panelId}, ${categoryId})
					`;
				}
			}

			const links = await sql<{ categoryId: number }[]>`
				SELECT category_id AS "categoryId" FROM ticket_panel_categories WHERE ticket_panel_id = ${panelId}
			`;

			return { ...panel!, categoryIds: links.map((link) => link.categoryId) } as TicketPanelWithCategories;
		});
	},
});
