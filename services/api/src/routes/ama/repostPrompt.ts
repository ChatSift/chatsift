import { getContext } from '@chatsift/backend-core';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import { badData, notFound, internal } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { AMAPromptDataRow, AMASessionRow } from '../../util/amaTypes.js';
import { discordAPIAma } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';

const bodySchema = z.strictObject({});
const paramsSchema = z.object({ guildId: snowflakeSchema, amaId: z.coerce.number().int().positive() });

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

		const [existingAMA] = await getContext().rawDb<AMASessionRow[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!existingAMA) {
			throw notFound('ama session not found');
		}

		const [promptData] = await getContext().rawDb<AMAPromptDataRow[]>`
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
			await getContext().rawDb`
				UPDATE ama_prompt_data SET prompt_message_id = ${newPromptMessage.id} WHERE ama_id = ${amaId}
			`;
		} catch (error) {
			// If we created the prompt message but failed to insert data, delete the message to avoid orphaned prompts.
			// eslint-disable-next-line promise/prefer-await-to-then
			void discordAPIAma.channels.deleteMessage(existingAMA.promptChannelId, newPromptMessage.id).catch(() => null);
			throw error;
		}
	},
});
