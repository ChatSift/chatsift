import { getContext } from '@chatsift/backend-core';
import type { Categories, TicketPanels } from '@chatsift/db';
import type { RESTPostAPIChannelMessageJSONBody } from '@discordjs/core';
import { ButtonStyle, ComponentType, RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, badRequest } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { assertChannelsBelongToGuild } from '../../../util/channels.js';
import { discordAPIModmail } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { createPanelBodySchema } from '../schemas.js';
import type { TicketPanelWithCategories } from './listPanels.js';

const bodySchema = createPanelBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreatePanelBody = z.input<typeof bodySchema>;
export type CreatePanelResult = TicketPanelWithCategories;

export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/modmail/panels',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<CreatePanelResult> {
		const data = req.body;
		const { guildId } = req.params;
		const db = getContext().db;

		await assertChannelsBelongToGuild(guildId, [data.channelId], discordAPIModmail, req.logger);

		const categories = await db<Pick<Categories, 'id'>[]>`
			SELECT id FROM categories WHERE guild_id = ${guildId} AND id IN ${db(data.categoryIds)}
		`;

		if (categories.length !== data.categoryIds.length) {
			throw badRequest('one or more categoryIds do not belong to this guild');
		}

		let panelMessage: Awaited<ReturnType<typeof discordAPIModmail.channels.createMessage>> | undefined;
		try {
			const messageBodyBase: RESTPostAPIChannelMessageJSONBody =
				'panel_raw' in data
					? data.panel_raw
					: {
							embeds: [
								{
									// TODO: real constant
									color: 0x7289da, // blurple
									title: data.panel.title,
									description: data.panel.description,
								},
							],
						};

			try {
				panelMessage = await discordAPIModmail.channels.createMessage(data.channelId, {
					...messageBodyBase,
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									style: ButtonStyle.Primary,
									label: 'panel' in data ? data.panel.buttonLabel : 'Create Ticket',
									custom_id: 'modmail-create-ticket',
								},
							],
						},
					],
				});
			} catch (error) {
				if (error instanceof DiscordAPIError && error.status === 400 && 'panel_raw' in data) {
					throw badData('invalid panel_raw data');
				}

				if (
					error instanceof DiscordAPIError &&
					error.status === 403 &&
					(error.code === RESTJSONErrorCodes.MissingAccess || error.code === RESTJSONErrorCodes.MissingPermissions)
				) {
					throw badRequest('the bot is missing permissions to post in the selected channel');
				}

				throw error;
			}

			return await db.begin(async (sql) => {
				const [panel] = await sql<TicketPanels[]>`
					INSERT INTO ticket_panels (guild_id, channel_id, message_id, panel_json_data)
					VALUES (${guildId}, ${data.channelId}, ${panelMessage!.id}, ${JSON.stringify(messageBodyBase)})
					RETURNING *
				`;

				for (const categoryId of data.categoryIds) {
					await sql`
						INSERT INTO ticket_panel_categories (ticket_panel_id, category_id)
						VALUES (${panel!.id}, ${categoryId})
					`;
				}

				return { ...panel!, categoryIds: data.categoryIds } as TicketPanelWithCategories;
			});
		} catch (error) {
			if (panelMessage) {
				// eslint-disable-next-line promise/prefer-await-to-then
				void discordAPIModmail.channels.deleteMessage(data.channelId, panelMessage.id).catch(() => null);
			}

			throw error;
		}
	},
});
