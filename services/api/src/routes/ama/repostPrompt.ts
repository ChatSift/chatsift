import { getContext } from '@chatsift/backend-core';
import type { AmaPromptData, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import { badData, notFound, internal } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { discordAPIAma } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';

const bodySchema = z.strictObject({});
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
});

export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/prompt',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<void> {
		const { guildId, amaId } = req.params;

		const [existingAMA] = await getContext().db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!existingAMA) {
			throw notFound('ama session not found');
		}

		const [promptData] = await getContext().db<AmaPromptData[]>`
			SELECT * FROM ama_prompt_data WHERE ama_id = ${amaId}
		`;

		if (!promptData) {
			throw internal();
		}

		// Check if message still exists
		let messageExists = false;
		try {
			await discordAPIAma.channels.getMessage(existingAMA.promptChannelId, promptData.promptMessageId);
			messageExists = true;
		} catch {
			messageExists = false;
		}

		if (messageExists) {
			throw badData('prompt message still exists');
		}

		// Parse the stored prompt data
		const messageBody = JSON.parse(promptData.promptJsonData);

		// Create new prompt message
		const newPromptMessage = await discordAPIAma.channels.createMessage(existingAMA.promptChannelId, {
			...messageBody,
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							type: ComponentType.Button,
							style: ButtonStyle.Primary,
							label: 'Submit a question',
							custom_id: 'submit-question',
						},
					],
				},
			],
		});

		try {
			// Conditional on the prompt_message_id we actually read above — if a concurrent repost already changed
			// it, this affects zero rows instead of silently overwriting the other request's message.
			const updateResult = await getContext().db`
				UPDATE ama_prompt_data
				SET prompt_message_id = ${newPromptMessage.id}
				WHERE ama_id = ${amaId} AND prompt_message_id = ${promptData.promptMessageId}
			`;

			if (updateResult.count === 0) {
				throw badData('prompt was already reposted concurrently');
			}
		} catch (error) {
			// If we created the prompt message but failed to persist it — including the concurrent-repost case
			// above — delete it to avoid leaving it orphaned.
			// eslint-disable-next-line promise/prefer-await-to-then
			void discordAPIAma.channels.deleteMessage(existingAMA.promptChannelId, newPromptMessage.id).catch(() => null);
			throw error;
		}
	},
});
