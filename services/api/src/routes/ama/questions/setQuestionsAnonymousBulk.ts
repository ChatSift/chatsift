import { getContext } from '@chatsift/backend-core';
import { amaPublicAnswersChannel, amaQuestionsChannel, resolveEmbedsForEdit } from '@chatsift/core';
import type { AmaQuestions, AmaQuestionsId, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { amaModerationDecisions } from '../../../core/metrics.js';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIAma } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildQuestionEmbeds, resolveCurrentQueueMessage } from './util.js';

// Same cap and reasoning as `mergeQuestionsBulk.ts`: it matches what the dashboard's selection mode can
// realistically hand over, and each id past it is another Discord message to re-render.
const bodySchema = z.strictObject({
	anonymous: z.boolean(),
	questionIds: z.array(z.number().int().positive()).min(1).max(100),
});
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
});

export type SetQuestionsAnonymousBulkBody = z.input<typeof bodySchema>;

export interface SetQuestionsAnonymousBulkResult {
	/**
	 * Questions whose row was updated but whose live answers-channel message could not be re-rendered, so
	 * Discord still shows (or still hides) the author. Handed back rather than swallowed so the dashboard can
	 * name them -- the single-question toggle refuses to save at all in this situation, and retrying it on one
	 * of these is the fix.
	 */
	failedToRefresh: number[];
	questions: AmaQuestions[];
}

/**
 * Bulk counterpart to `updateQuestion.ts`'s anonymous mode (#366): the request that motivated the feature was
 * "a lot of questions sent by staff", which is a batch, not one row at a time.
 *
 * Where the single-question route treats a failed Discord edit as a reason to save nothing, this one commits
 * the whole batch first and reports which messages it could not refresh. Refusing the batch over one
 * unreachable message would leave the caller with no way to apply the other 99, and the overwhelming majority
 * of a bulk selection has no live public message at all -- only an already-'ASKED' question does, and those
 * are the tail of a queue being cleaned up, not the bulk of it.
 */
export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/questions/anonymous-bulk',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: 'or-ama-guest',
	}),
	// The public answers page as well as the dashboard list: an 'ASKED' question in the batch is one that page
	// is already showing an author for.
	realtimeChannel: (req) => [
		amaQuestionsChannel(req.params.guildId, req.params.amaId),
		amaPublicAnswersChannel(req.params.amaId),
	],
	async handler(req): Promise<SetQuestionsAnonymousBulkResult> {
		const { guildId, amaId } = req.params;
		const { anonymous, questionIds } = req.body;
		const db = getContext().db;

		const [session] = await db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		const ids = [...new Set(questionIds)] as AmaQuestionsId[];
		const existing = await db<AmaQuestions[]>`
			SELECT * FROM ama_questions WHERE id = ANY(${ids}) AND ama_id = ${amaId}
		`;

		if (existing.length !== ids.length) {
			throw notFound('one or more selected questions were not found in this AMA');
		}

		const questions = await db<AmaQuestions[]>`
			UPDATE ama_questions SET anonymous = ${anonymous}, updated_at = now()
			WHERE id = ANY(${ids}) AND ama_id = ${amaId}
			RETURNING *
		`;

		// The rows that actually moved -- a selection routinely includes questions already in the requested state,
		// and counting those would inflate the metric with no-ops and make this path disagree with the bot's own
		// toggle, which only counts a real flip. Both directions count as `anonymize`, same as the bot: the
		// decision being recorded is "a moderator set who this question publishes as", not which way it went.
		const changed = existing.filter((question) => question.anonymous !== anonymous);
		amaModerationDecisions.inc({ decision: 'anonymize', source: 'dashboard' }, changed.length);

		// Only the changed rows, and only the ones with a live public message: re-rendering a question already in
		// the requested state would spend a Discord round trip to produce the identical embed, and the queue
		// surface shows the real author whatever the flag says.
		const failedToRefresh: number[] = [];

		await Promise.all(
			changed.map(async (question) => {
				const currentMessage = resolveCurrentQueueMessage(question, session);
				if (currentMessage?.kind !== 'answers') {
					return;
				}

				try {
					const embeds = await buildQuestionEmbeds(
						guildId,
						{ ...question, anonymous },
						session,
						// `liveQuestion` is the pre-update row: recovering the question's images reads the message as
						// it exists right now. See `buildQuestionEmbeds`' own doc on the option.
						{ kind: currentMessage.kind, liveQuestion: question },
					);
					await discordAPIAma.channels.editMessage(currentMessage.channelId, currentMessage.messageId, {
						embeds: resolveEmbedsForEdit(embeds),
					});
				} catch {
					failedToRefresh.push(question.id);
				}
			}),
		);

		return { failedToRefresh, questions };
	},
});
