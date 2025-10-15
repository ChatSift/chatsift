import { getContext } from '@chatsift/backend-core';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import { badData, notFound } from '@hapi/boom';
import type { NextHandler, Response } from 'polka';
import { z } from 'zod';
import { isAuthed } from '../../middleware/isAuthed.js';
import { discordAPIAma } from '../../util/discordAPI.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

const bodySchema = z.strictObject({});

export default class RepostPrompt extends Route<never, typeof bodySchema> {
	public readonly info = {
		method: RouteMethod.post,
		path: '/v3/guilds/:guildId/ama/amas/:amaId/prompt',
	} as const;

	public override readonly bodyValidationSchema = bodySchema;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	];

	public override async handle(req: TRequest<typeof bodySchema>, res: Response, next: NextHandler) {
		const { guildId, amaId } = req.params as { amaId: string; guildId: string };

		const existingAMA = await getContext()
			.db.selectFrom('AMASession')
			.selectAll()
			.where('guildId', '=', guildId)
			.where('id', '=', Number(amaId))
			.executeTakeFirst();

		if (!existingAMA) {
			return next(notFound('ama session not found'));
		}

		const promptData = await getContext()
			.db.selectFrom('AMAPromptData')
			.selectAll()
			.where('amaId', '=', Number(amaId))
			.executeTakeFirstOrThrow();

		// Check if message still exists
		let messageExists = false;
		try {
			await discordAPIAma.channels.getMessage(existingAMA.promptChannelId, promptData.promptMessageId);
			messageExists = true;
		} catch {
			messageExists = false;
		}

		if (messageExists) {
			return next(badData('prompt message still exists'));
		}

		// Parse the stored prompt data
		const messageBody = JSON.parse(promptData.promptJSONData);

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
			await getContext()
				.db.updateTable('AMAPromptData')
				.set({ promptMessageId: newPromptMessage.id })
				.where('amaId', '=', Number(amaId))
				.execute();
		} catch (error) {
			// If we created the prompt message but failed to insert data, delete the message to avoid orphaned prompts.
			// eslint-disable-next-line promise/prefer-await-to-then
			void discordAPIAma.channels.deleteMessage(existingAMA.promptChannelId, newPromptMessage.id).catch(() => null);
			throw error;
		}

		res.statusCode = 200;
		return res.end();
	}
}
