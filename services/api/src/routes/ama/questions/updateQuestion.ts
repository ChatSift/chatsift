import { getContext } from '@chatsift/backend-core';
import { getBaseEmbeds, withResolvedActionRow } from '@chatsift/core';
import type { AmaQuestions, AmaQuestionsId, AmaQuestionState, AmaSessions, AmaSessionsId } from '@chatsift/db';
import type { APIButtonComponent } from '@discordjs/core';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import { badRequest, conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIAma } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { resolveAmaUser, resolveCurrentQueueMessage, resolveQuestionAttachments } from './util.js';

const stateModeSchema = z.strictObject({
	state: z.enum(['APPROVED', 'DENIED', 'FLAGGED']),
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
	fromState: AmaQuestionState,
	style: ClickableButtonStyle,
	label: string,
): Promise<void> {
	const channelId =
		fromState === 'PENDING_MOD_REVIEW'
			? session.modQueueId
			: fromState === 'PENDING_GUEST_REVIEW'
				? session.guestQueueId
				: null;
	const messageId =
		fromState === 'PENDING_MOD_REVIEW'
			? question.modQueueMessageId
			: fromState === 'PENDING_GUEST_REVIEW'
				? question.guestQueueMessageId
				: null;

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
		isGuildManager: true,
	}),
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
						INSERT INTO ama_question_tag_assignments (question_id, tag_id)
						SELECT ${questionId}, id FROM ama_question_tags WHERE ama_id = ${amaId} AND id = ANY(${data.tagIds})
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
			// no more freeform ids, matching the same restriction the guest queue's Add Answer modal
			// applies once `guestIds` is non-empty (see `guestAddAnswer.ts`).
			if (data.answeredById && session.guestIds.length > 0 && !session.guestIds.includes(data.answeredById)) {
				throw badRequest("answeredById must be one of this AMA's configured guests");
			}

			// Defaults to the dashboard user making the edit, not the question's own author -- mirrors
			// `guestAddAnswer.ts`'s modal, which defaults to whichever guest/mod submitted it. Distinct
			// from `answerContent`/`answerImageUrl` above: `answeredById` needs to tell "field omitted,
			// leave as-is" apart from "field explicitly cleared back to the default" -- an explicit
			// `null` (the dashboard's "Default (you)" option) must actually reset it, not fall through
			// to whatever guest was previously set.
			const answeredById =
				'answeredById' in data ? (data.answeredById ?? req.tokens.access.sub) : question.answeredById;

			const [updated] = await db<AmaQuestions[]>`
				UPDATE ama_questions
				SET
					answer_content = ${data.answerContent ?? question.answerContent},
					answer_image_url = ${data.answerImageUrl ?? question.answerImageUrl},
					answered_by_id = ${answeredById ?? req.tokens.access.sub},
					answered_at = now(),
					updated_at = now()
				WHERE id = ${questionId}
				RETURNING *
			`;

			return updated!;
		}

		// State-transition mode -- replicates the bot's atomic-claim + Discord-side-effect pattern from
		// the dashboard, keying stage existence off `*_review_enabled` and Discord posting off `*_queue_id`
		// (see schema.sql's comments on those columns / docs/roadmap's #293 follow-up).
		if (data.state === 'DENIED') {
			if (question.state !== 'PENDING_MOD_REVIEW' && question.state !== 'PENDING_GUEST_REVIEW') {
				throw badRequest(`cannot deny a question in state ${question.state}`);
			}

			const fromState = question.state;
			const [denied] = await db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'DENIED', updated_at = now()
				WHERE id = ${questionId} AND state = ${fromState}
				RETURNING *
			`;

			if (!denied) {
				throw conflict('this question was already handled by someone else');
			}

			await markSourceMessageResolved(question, session, fromState, ButtonStyle.Danger, '❌ Denied');
			return denied;
		}

		if (data.state === 'FLAGGED') {
			if (question.state !== 'PENDING_MOD_REVIEW') {
				throw badRequest(`cannot flag a question in state ${question.state}`);
			}

			let flaggedMessageId: string | null = null;
			if (session.flaggedQueueId) {
				const [attachments, user] = await Promise.all([
					resolveQuestionAttachments(question, session),
					resolveAmaUser(guildId, question.authorId),
				]);
				const embeds = getBaseEmbeds({
					attachments,
					content: question.content,
					guildId,
					includeUserId: true,
					user: typeof user === 'string' ? undefined : user,
				});
				const message = await discordAPIAma.channels.createMessage(session.flaggedQueueId, { embeds });
				flaggedMessageId = message.id;
			}

			const [flagged] = await db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'FLAGGED', flagged_queue_message_id = ${flaggedMessageId}, updated_at = now()
				WHERE id = ${questionId} AND state = 'PENDING_MOD_REVIEW'
				RETURNING *
			`;

			if (!flagged) {
				if (flaggedMessageId) {
					// eslint-disable-next-line promise/prefer-await-to-then
					void discordAPIAma.channels.deleteMessage(session.flaggedQueueId!, flaggedMessageId).catch(() => null);
				}

				throw conflict('this question was already handled by someone else');
			}

			await markSourceMessageResolved(question, session, question.state, ButtonStyle.Secondary, '⚠️ Flagged');
			return flagged;
		}

		// data.state === 'APPROVED'
		if (question.state === 'PENDING_MOD_REVIEW') {
			const fromState = question.state;

			// Guest review has no dash-only mode (guests generally don't have dashboard access) -- its
			// existence is just `guestQueueId` truthiness, unlike mod review's separate enabled flag.
			if (session.guestQueueId) {
				const [attachments, user] = await Promise.all([
					resolveQuestionAttachments(question, session),
					resolveAmaUser(guildId, question.authorId),
				]);
				const embeds = getBaseEmbeds({
					attachments,
					content: question.content,
					guildId,
					user: typeof user === 'string' ? undefined : user,
				});
				const buttons: APIButtonComponent[] = session.preparedAnswersEnabled
					? [
							{
								type: ComponentType.Button,
								style: ButtonStyle.Success,
								label: 'Add Answer',
								custom_id: `guest-add-answer:${question.id}`,
							},
						]
					: [
							{
								type: ComponentType.Button,
								style: ButtonStyle.Success,
								label: 'Answer',
								custom_id: `guest-approve:${question.id}`,
							},
						];
				buttons.push({
					type: ComponentType.Button,
					style: ButtonStyle.Secondary,
					label: 'Skip',
					custom_id: `guest-skip:${question.id}`,
				});
				const message = await discordAPIAma.channels.createMessage(session.guestQueueId, {
					embeds,
					components: [{ type: ComponentType.ActionRow, components: buttons }],
				});

				const [routed] = await db<AmaQuestions[]>`
					UPDATE ama_questions
					SET state = 'PENDING_GUEST_REVIEW', guest_queue_message_id = ${message.id}, updated_at = now()
					WHERE id = ${questionId} AND state = 'PENDING_MOD_REVIEW'
					RETURNING *
				`;

				if (!routed) {
					// eslint-disable-next-line promise/prefer-await-to-then
					void discordAPIAma.channels.deleteMessage(session.guestQueueId, message.id).catch(() => null);
					throw conflict('this question was already handled by someone else');
				}

				await markSourceMessageResolved(question, session, fromState, ButtonStyle.Success, '✅ Approved');
				return routed;
			}

			if (session.preparedAnswersEnabled) {
				const [approved] = await db<AmaQuestions[]>`
					UPDATE ama_questions SET state = 'APPROVED', updated_at = now()
					WHERE id = ${questionId} AND state = 'PENDING_MOD_REVIEW'
					RETURNING *
				`;

				if (!approved) {
					throw conflict('this question was already handled by someone else');
				}

				await markSourceMessageResolved(
					question,
					session,
					fromState,
					ButtonStyle.Success,
					'✅ Approved - awaiting send',
				);
				return approved;
			}

			const [attachments, user] = await Promise.all([
				resolveQuestionAttachments(question, session),
				resolveAmaUser(guildId, question.authorId),
			]);
			const embeds = getBaseEmbeds({
				attachments,
				content: question.content,
				guildId,
				user: typeof user === 'string' ? undefined : user,
			});
			const message = await discordAPIAma.channels.createMessage(session.answersChannelId, { embeds });

			const [asked] = await db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'ASKED', answers_message_id = ${message.id}, updated_at = now()
				WHERE id = ${questionId} AND state = 'PENDING_MOD_REVIEW'
				RETURNING *
			`;

			if (!asked) {
				// eslint-disable-next-line promise/prefer-await-to-then
				void discordAPIAma.channels.deleteMessage(session.answersChannelId, message.id).catch(() => null);
				throw conflict('this question was already handled by someone else');
			}

			await markSourceMessageResolved(question, session, fromState, ButtonStyle.Success, '✅ Approved');
			return asked;
		}

		if (question.state === 'PENDING_GUEST_REVIEW') {
			const fromState = question.state;

			if (session.preparedAnswersEnabled) {
				const [approved] = await db<AmaQuestions[]>`
					UPDATE ama_questions SET state = 'APPROVED', updated_at = now()
					WHERE id = ${questionId} AND state = 'PENDING_GUEST_REVIEW'
					RETURNING *
				`;

				if (!approved) {
					throw conflict('this question was already handled by someone else');
				}

				await markSourceMessageResolved(
					question,
					session,
					fromState,
					ButtonStyle.Success,
					'✅ Approved - awaiting send',
				);
				return approved;
			}

			const [attachments, user] = await Promise.all([
				resolveQuestionAttachments(question, session),
				resolveAmaUser(guildId, question.authorId),
			]);
			const embeds = getBaseEmbeds({
				attachments,
				content: question.content,
				guildId,
				user: typeof user === 'string' ? undefined : user,
			});
			const message = await discordAPIAma.channels.createMessage(session.answersChannelId, { embeds });

			const [asked] = await db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'ASKED', answers_message_id = ${message.id}, updated_at = now()
				WHERE id = ${questionId} AND state = 'PENDING_GUEST_REVIEW'
				RETURNING *
			`;

			if (!asked) {
				// eslint-disable-next-line promise/prefer-await-to-then
				void discordAPIAma.channels.deleteMessage(session.answersChannelId, message.id).catch(() => null);
				throw conflict('this question was already handled by someone else');
			}

			await markSourceMessageResolved(question, session, fromState, ButtonStyle.Success, '✅ Answered');
			return asked;
		}

		throw badRequest(`cannot approve a question in state ${question.state}`);
	},
});
