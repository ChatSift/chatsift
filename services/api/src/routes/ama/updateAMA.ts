import { getContext } from '@chatsift/backend-core';
import type { AmaPromptData, AmaSessions, AmaSessionsId } from '@chatsift/db';
import type { RESTPostAPIChannelMessageJSONBody } from '@discordjs/core';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, badRequest, internal, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { assertChannelsBelongToGuild } from '../../util/channels.js';
import { discordAPIAma } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';
import { updateAMABodySchema } from './schemas.js';

const bodySchema = updateAMABodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
});

export type UpdateAMABody = z.input<typeof bodySchema>;
export type UpdateAMAResult = AmaSessions;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/ama/amas/:amaId',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpdateAMAResult> {
		const data = req.body;
		const { guildId, amaId } = req.params;
		const db = getContext().db;

		const [existingAMA] = await db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!existingAMA) {
			throw notFound('AMA session not found');
		}

		if (existingAMA.ended) {
			throw badData('AMA session is already ended');
		}

		if ('ended' in data) {
			const [updated] = await db<AmaSessions[]>`
				UPDATE ama_sessions
				SET ended = ${data.ended}
				WHERE id = ${amaId} AND guild_id = ${guildId}
				RETURNING *
			`;

			return updated!;
		}

		await assertChannelsBelongToGuild(guildId, [data.answersChannelId, data.queueId], 'AMA', req.logger);

		// Dash-only review (#293 follow-up): a queue channel can only be set while review is enabled.
		// Unlike `createAMA.ts`'s schema-level refine, this is a partial update -- either field might be
		// omitted from `data` -- so the effective (post-merge) values have to be checked here against the
		// existing row, mirroring the DB's own CHECK constraint.
		const effectiveReviewEnabled = data.reviewEnabled ?? existingAMA.reviewEnabled;
		const effectiveQueueId = 'queueId' in data ? data.queueId : existingAMA.queueId;
		if (!effectiveReviewEnabled && effectiveQueueId) {
			throw badRequest('queueId can only be set when reviewEnabled is true');
		}

		const { prompt, prompt_raw, guestIds, ...configFields } = data;

		let promptJsonData: string | undefined;
		if (prompt ?? prompt_raw) {
			const [promptData] = await db<AmaPromptData[]>`
				SELECT * FROM ama_prompt_data WHERE ama_id = ${amaId}
			`;

			if (!promptData) {
				// Invariant: every ama_sessions row has exactly one ama_prompt_data row, written atomically in
				// createAMA.ts's transaction. Mirrors the same guard in repostPrompt.ts/getAMA.ts.
				throw internal();
			}

			const messageBodyBase: RESTPostAPIChannelMessageJSONBody = prompt_raw ?? {
				content: prompt!.plainText,
				embeds: [
					{
						// TODO: real constant
						color: 0x7289da, // blurple
						title: configFields.title ?? existingAMA.title,
						description: prompt!.description,
						image: prompt!.imageURL ? { url: prompt!.imageURL } : undefined,
						thumbnail: prompt!.thumbnailURL ? { url: prompt!.thumbnailURL } : undefined,
						timestamp: new Date().toISOString(),
					},
				],
			};

			try {
				await discordAPIAma.channels.editMessage(existingAMA.promptChannelId, promptData.promptMessageId, {
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
				if (error instanceof DiscordAPIError && error.status === 400 && prompt_raw) {
					throw badData('invalid prompt_raw data');
				}

				if (error instanceof DiscordAPIError && error.status === 404) {
					throw badData('prompt message no longer exists on Discord; repost it first, then edit');
				}

				throw error;
			}

			promptJsonData = JSON.stringify(messageBodyBase);
		}

		return db.begin(async (sql) => {
			let updated: AmaSessions = existingAMA;

			if (Object.keys(configFields).length > 0) {
				const columns = Object.keys(configFields) as (keyof typeof configFields)[];
				const [row] = await sql<AmaSessions[]>`
					UPDATE ama_sessions
					SET ${sql(configFields, ...columns)}
					WHERE id = ${amaId} AND guild_id = ${guildId}
					RETURNING *
				`;
				updated = row!;
			}

			// Kept as a separate statement from the dynamic `configFields` update above -- postgres.js needs
			// `sql.array()` to type an empty array correctly (`guestIds` can be cleared back to `[]`), which
			// the generic `sql(configFields, ...columns)` helper above has no way to apply per-column.
			if (guestIds !== undefined) {
				const [row] = await sql<AmaSessions[]>`
					UPDATE ama_sessions
					SET guest_ids = ${sql.array(guestIds)}
					WHERE id = ${amaId} AND guild_id = ${guildId}
					RETURNING *
				`;
				updated = row!;
			}

			if (promptJsonData) {
				await sql`UPDATE ama_prompt_data SET prompt_json_data = ${promptJsonData} WHERE ama_id = ${amaId}`;
			}

			return updated!;
		});
	},
});
