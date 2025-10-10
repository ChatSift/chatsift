import type { AMASession } from '@chatsift/core';
import type { RESTPostAPIChannelMessageJSONBody } from '@discordjs/core';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badRequest } from '@hapi/boom';
import type { Selectable } from 'kysely';
import type { NextHandler, Response } from 'polka';
import { z } from 'zod';
import { context } from '../../context.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { discordAPIAma } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';

const promptSchema = z.union([
	z.strictObject({
		prompt: z
			.object({
				description: z.string().max(4_000).optional(),
				plainText: z.string().max(100).optional(),
				imageURL: z.url().optional(),
				thumbnailURL: z.url().optional(),
			})
			.strict(),
	}),
	z.strictObject({
		prompt_raw: z.strictObject({
			content: z.string().optional(),
			embeds: z.array(z.any()).optional(),
		}),
	}),
]);

const bodySchema = z.intersection(
	z.strictObject({
		modQueueId: snowflakeSchema.nullable(),
		flaggedQueueId: snowflakeSchema.nullable(),
		guestQueueId: snowflakeSchema.nullable(),
		title: z.string().min(1).max(255),
		answersChannelId: snowflakeSchema,
		promptChannelId: snowflakeSchema,
	}),
	promptSchema,
);

export type CreateAMABody = z.input<typeof bodySchema>;

export type CreateAMAResult = Selectable<AMASession>;

export default class CreateAMA extends Route<CreateAMAResult, typeof bodySchema> {
	public readonly info = {
		method: RouteMethod.post,
		path: '/v3/guilds/:guildId/ama/amas',
	} as const;

	public override readonly bodyValidationSchema = bodySchema;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	];

	public override async handle(req: TRequest<typeof bodySchema>, res: Response, next: NextHandler) {
		const data = req.body;
		const { guildId } = req.params as { guildId: string };

		// TODO(DD): Reconsider?
		const messageBodyBase: RESTPostAPIChannelMessageJSONBody =
			'prompt_raw' in data
				? data.prompt_raw
				: {
						content: data.prompt.plainText,
						embeds: [
							{
								color: 0x7289da, // blurple
								title: data.title,
								description: data.prompt.description,
								image: data.prompt.imageURL ? { url: data.prompt.imageURL } : undefined,
								thumbnail: data.prompt.thumbnailURL ? { url: data.prompt.thumbnailURL } : undefined,
								timestamp: new Date().toISOString(),
							},
						],
					};

		let promptMessage;
		try {
			promptMessage = await discordAPIAma.channels.createMessage(data.promptChannelId, {
				...messageBodyBase,
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
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 400 && 'prompt_raw' in data) {
				return next(badRequest('invalid prompt_raw data'));
			}

			throw error;
		}

		const created: CreateAMAResult = await context.db
			.insertInto('AMASession')
			.values({
				guildId,
				title: data.title,
				answersChannelId: data.answersChannelId,
				promptChannelId: data.promptChannelId,
				promptMessageId: promptMessage.id,
				modQueueId: data.modQueueId,
				flaggedQueueId: data.flaggedQueueId,
				guestQueueId: data.guestQueueId,
				ended: false,
				createdAt: new Date(),
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify(created));
	}
}
