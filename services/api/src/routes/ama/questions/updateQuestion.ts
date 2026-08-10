import { getContext } from '@chatsift/backend-core';
import { amaPublicAnswersChannel, amaQuestionsChannel, withResolvedActionRow } from '@chatsift/core';
import type { AmaQuestions, AmaQuestionsId, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import { badRequest, conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIAma } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildQuestionEmbeds } from './util.js';

const stateModeSchema = z.strictObject({
	state: z.enum(['APPROVED', 'DENIED']),
});

const answerModeSchema = z
	.strictObject({
		answerContent: z.string().min(1).max(4_000).nullable().optional(),
		answerImageUrl: z.url().nullable().optional(),
		answeredById: snowflakeSchema.nullable().optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

const tagsModeSchema = z.strictObject({
	tagIds: z.array(z.number().int().positive()),
});

const bodySchema = z.union([stateModeSchema, answerModeSchema, tagsModeSchema]);
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
	questionId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaQuestionsId),
});

export type UpdateQuestionBody = z.input<typeof bodySchema>;
export type UpdateQuestionResult = AmaQuestions;

type ClickableButtonStyle = ButtonStyle.Danger | ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success;

async function markSourceMessageResolved(
	question: AmaQuestions,
	session: AmaSessions,
	style: ClickableButtonStyle,
	label: string,
): Promise<void> {
	const channelId = session.queueId;
	const messageId = question.queueMessageId;

	if (!channelId || !messageId) {
		return;
	}

	try {
		const message = await discordAPIAma.channels.getMessage(channelId, messageId);
		await discordAPIAma.channels.editMessage(channelId, messageId, {
			components: withResolvedActionRow(message.components, {
				type: ComponentType.Button,
				style,
				label,
				custom_id: 'dashboard-resolved-disabled',
				disabled: true,
			}),
		});
	} catch {
		// Best-effort -- the row's DB state is the source of truth; a stale/deleted Discord message
		// failing to update shouldn't fail the dashboard action itself.
	}
}

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/questions/:questionId',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: 'or-ama-guest',
	}),
	// Two audiences: the dashboard's question list, and the public answers page (#323) -- the direct-approve
	// branch below can post straight to the answers channel, which is what that page mirrors.
	realtimeChannel: (req) => [
		amaQuestionsChannel(req.params.guildId, req.params.amaId),
		amaPublicAnswersChannel(req.params.amaId),
	],
	async handler(req): Promise<UpdateQuestionResult> {
		const { guildId, amaId, questionId } = req.params;
		const data = req.body;
		const db = getContext().db;

		const [session] = await db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		const [question] = await db<AmaQuestions[]>`
			SELECT * FROM ama_questions WHERE id = ${questionId} AND ama_id = ${amaId}
		`;

		if (!question) {
			throw notFound('question not found');
		}

		if ('tagIds' in data) {
			return db.begin(async (sql) => {
				await sql`DELETE FROM ama_question_tag_assignments WHERE question_id = ${questionId}`;

				if (data.tagIds.length > 0) {
					await sql`
						INSERT INTO ama_question_tag_assignments (question_id, tag_id, ama_id)
						SELECT ${questionId}, id, ${amaId} FROM ama_question_tags WHERE ama_id = ${amaId} AND id = ANY(${data.tagIds})
					`;
				}

				return question;
			});
		}

		if (!('state' in data)) {
			// Once sent, the answer already went out in the Discord message as-is -- editing it here
			// afterward would silently diverge from what was actually posted.
			if (question.state === 'ASKED') {
				throw badRequest('cannot edit the answer after the question has been sent');
			}

			// Once a guest list is configured for this AMA, "answered by" must be one of those guests --
			// no more freeform ids.
			if (data.answeredById && session.guestIds.length > 0 && !session.guestIds.includes(data.answeredById)) {
				throw badRequest("answeredById must be one of this AMA's configured guests");
			}

			// Defaults to the dashboard user making the edit, not the question's own author. Distinct
			// from `answerContent`/`answerImageUrl` above: `answeredById` needs to tell "field omitted,
			// leave as-is" apart from "field explicitly cleared back to the default" -- an explicit
			// `null` (the dashboard's "Default (you)" option) must actually reset it, not fall through
			// to whatever guest was previously set.
			const answeredById =
				'answeredById' in data ? (data.answeredById ?? req.tokens.access.sub) : question.answeredById;
			// Same "field omitted vs. explicitly cleared" distinction as `answeredById` above -- `data.answerContent
			// ?? question.answerContent` would treat an explicit `null` (clearing a prepared answer back out)
			// identically to the field never being sent at all, making it impossible to ever clear these back to null.
			// The `?? null` never actually changes behavior here (a present JSON key can't parse to `undefined`,
			// only a real `string` or `null`) -- it's purely to satisfy postgres.js's tagged-template typing,
			// which doesn't accept `undefined` as an interpolated value.
			const answerContent = 'answerContent' in data ? (data.answerContent ?? null) : question.answerContent;
			const answerImageUrl = 'answerImageUrl' in data ? (data.answerImageUrl ?? null) : question.answerImageUrl;

			const [updated] = await db<AmaQuestions[]>`
				UPDATE ama_questions
				SET
					answer_content = ${answerContent},
					answer_image_url = ${answerImageUrl},
					answered_by_id = ${answeredById ?? req.tokens.access.sub},
					answered_at = now(),
					updated_at = now()
				WHERE id = ${questionId}
				RETURNING *
			`;

			// The question can vanish between the initial read above and this write (e.g. a concurrent
			// duplicate-merge deleting it) -- treat that the same as any other not-found rather than crashing
			// on a non-null assertion.
			if (!updated) {
				throw notFound('question not found');
			}

			return updated;
		}

		// State-transition mode -- replicates the bot's atomic-claim + Discord-side-effect pattern from
		// the dashboard, keying review's existence off `review_enabled` and Discord posting off
		// `queue_id` (see schema.sql's comments on those columns / docs/roadmap's #293 follow-up).
		if (data.state === 'DENIED') {
			if (question.state !== 'PENDING_REVIEW') {
				throw badRequest(`cannot deny a question in state ${question.state}`);
			}

			const [denied] = await db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'DENIED', updated_at = now()
				WHERE id = ${questionId} AND state = 'PENDING_REVIEW'
				RETURNING *
			`;

			if (!denied) {
				throw conflict('this question was already handled by someone else');
			}

			await markSourceMessageResolved(question, session, ButtonStyle.Danger, '❌ Denied');
			return denied;
		}

		// data.state === 'APPROVED'
		if (question.state !== 'PENDING_REVIEW') {
			throw badRequest(`cannot approve a question in state ${question.state}`);
		}

		if (session.preparedAnswersEnabled) {
			const [approved] = await db<AmaQuestions[]>`
				UPDATE ama_questions SET state = 'APPROVED', updated_at = now()
				WHERE id = ${questionId} AND state = 'PENDING_REVIEW'
				RETURNING *
			`;

			if (!approved) {
				throw conflict('this question was already handled by someone else');
			}

			await markSourceMessageResolved(question, session, ButtonStyle.Success, '✅ Approved - awaiting send');
			return approved;
		}

		const embeds = await buildQuestionEmbeds(guildId, question, session);
		const message = await discordAPIAma.channels.createMessage(session.answersChannelId, { embeds });

		const [asked] = await db<AmaQuestions[]>`
			UPDATE ama_questions
			SET state = 'ASKED', answers_message_id = ${message.id}, updated_at = now()
			WHERE id = ${questionId} AND state = 'PENDING_REVIEW'
			RETURNING *
		`;

		if (!asked) {
			// eslint-disable-next-line promise/prefer-await-to-then
			void discordAPIAma.channels.deleteMessage(session.answersChannelId, message.id).catch(() => null);
			throw conflict('this question was already handled by someone else');
		}

		await markSourceMessageResolved(question, session, ButtonStyle.Success, '✅ Approved');
		return asked;
	},
});
