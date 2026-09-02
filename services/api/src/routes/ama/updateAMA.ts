import { getContext } from '@chatsift/backend-core';
import { DEFAULT_EMBED_COLOR } from '@chatsift/core';
import type { AmaPromptData, AmaSessions, AmaSessionsId } from '@chatsift/db';
import type { RESTPostAPIChannelMessageJSONBody } from '@discordjs/core';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, badRequest, internal, notFound } from '@hapi/boom';
import { z } from 'zod';
import { amaSessionTransitions } from '../../core/metrics.js';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { assertChannelsBelongToGuild } from '../../util/channels.js';
import { discordAPIAma } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';
import { hasDiscordMessageSurface, updateAMABodySchema, UPLOADS_WITHOUT_DISCORD_SURFACE_MESSAGE } from './schemas.js';

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

		// Deliberately no "session is closed, refuse to touch it" guard (#299): closing an AMA only stops new
		// question *submissions* -- triage, answering and config edits all continue afterwards, and closing is
		// reversible.
		if ('ended' in data) {
			// Reopening has to defuse an already-lapsed `scheduled_close_at`, otherwise ama-bot's
			// `scheduledCloseSweep.ts` (which matches on `scheduled_close_at <= now() AND ended = false`)
			// would immediately close the session again on its next tick. A future date is left alone --
			// that's still a close the owner asked for.
			const [updated] = await db<AmaSessions[]>`
				UPDATE ama_sessions
				SET ended = ${data.ended}
				${
					data.ended
						? db``
						: db`, scheduled_close_at = CASE WHEN scheduled_close_at <= now() THEN NULL ELSE scheduled_close_at END`
				}
				WHERE id = ${amaId} AND guild_id = ${guildId}
				RETURNING *
			`;

			// Only a close is a transition worth counting -- a reopen is the dashboard undoing one, and folding
			// the two into one counter would make the series read as activity where there was a correction.
			if (data.ended) {
				amaSessionTransitions.inc({ transition: 'closed', source: 'dashboard' });
			}

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

		// Same "check the effective post-merge values" treatment for #316's uploads rule, which `createAMA.ts`
		// gets from a schema-level refine it can't share here for the same partial-update reason.
		const effectiveAnswersChannelId = 'answersChannelId' in data ? data.answersChannelId : existingAMA.answersChannelId;
		const effectiveUploads = data.allowedQuestionUploads ?? existingAMA.allowedQuestionUploads;
		if (
			effectiveUploads > 0 &&
			!hasDiscordMessageSurface({ answersChannelId: effectiveAnswersChannelId, queueId: effectiveQueueId })
		) {
			throw badRequest(UPLOADS_WITHOUT_DISCORD_SURFACE_MESSAGE);
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
						color: prompt!.color ?? DEFAULT_EMBED_COLOR,
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
