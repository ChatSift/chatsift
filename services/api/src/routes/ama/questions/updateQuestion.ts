import { getContext } from '@chatsift/backend-core';
import {
	amaPublicAnswersChannel,
	amaQuestionsChannel,
	resolveEmbedsForEdit,
	withResolvedActionRow,
} from '@chatsift/core';
import type { AmaQuestions, AmaQuestionsId, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import { badGateway, badRequest, conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { amaModerationDecisions } from '../../../core/metrics.js';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIAma } from '../../../util/discordAPI.js';
import { isNotFoundDiscordError } from '../../../util/discordErrors.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildQuestionEmbeds, resolveCurrentQueueMessage } from './util.js';

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

// #366: publish (or stop publishing) this question without saying who asked it. Its own mode rather than a
// field on `answerModeSchema` -- it's about the question, not the answer, and unlike those fields it's
// settable in every state the dashboard shows a question in, including PENDING_REVIEW.
const anonymousModeSchema = z.strictObject({
	anonymous: z.boolean(),
});

// #366 PM feedback: whether an umbrella question publishes its merged-asker tally ("Asked by N people") or
// just the question. Its own mode alongside `anonymousModeSchema` rather than a second key on it -- the two
// are mutually exclusive by row (an umbrella question has no author to hide, and only an umbrella question
// has a tally to suppress), so a shape that let both arrive together would have to reject half of what it
// accepts.
const askerCountModeSchema = z.strictObject({
	showAskerCount: z.boolean(),
});

// #366 follow-up: reword a question after it was written. Restricted to umbrella questions in the handler --
// staff wrote that wording themselves, so it is theirs to change, whereas a submitted question's content is
// what its asker actually typed and rewriting it would publish someone else's words under their name.
const contentModeSchema = z.strictObject({
	// Same bounds as `createQuestion.ts`: staff-authored, so no 15-character floor from the submit modal, and
	// the same 4,000-character ceiling.
	content: z.string().trim().min(1).max(4_000),
});

const bodySchema = z.union([
	stateModeSchema,
	answerModeSchema,
	tagsModeSchema,
	anonymousModeSchema,
	askerCountModeSchema,
	contentModeSchema,
]);
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
	// branch below can post straight to the answers channel, which is what that page mirrors, and since #327
	// the answer branch can edit a question that's already on it.
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

		if ('anonymous' in data || 'showAskerCount' in data) {
			// The two flags are refused on the rows they don't describe rather than silently ignored there. An
			// umbrella question has no author to publish (see `createQuestion.ts`) -- accepting `anonymous: false`
			// on one would write a row saying "show the author" that every render then overrides, which is the
			// state that eventually gets read as a bug. And a plain question's tally is the entire point of
			// having merged duplicates into it, so nothing offers to hide it.
			if ('anonymous' in data && question.umbrella) {
				throw badRequest('an umbrella question is never published with an author');
			}

			if ('showAskerCount' in data && !question.umbrella) {
				throw badRequest('only an umbrella question can hide its asker count');
			}

			// Only the answers-channel message ever changes: the queue embed shows the real author whatever the
			// flag says (#366), so a question that hasn't been published yet has nothing to re-render. Where
			// there *is* a live public message, the Discord edit is the change -- run first, and on failure save
			// nothing, exactly like the already-'ASKED' answer edit below.
			const currentMessage = resolveCurrentQueueMessage(question, session);
			if (currentMessage?.kind === 'answers') {
				try {
					// The row as it's about to be written -- the embed has to render the incoming flag, not the
					// stored one. `liveQuestion` stays the stored row for the same reason the answer branch keeps
					// it: recovering the question's images reads the message as it exists right now.
					const projected: AmaQuestions = { ...question, ...data };
					const embeds = await buildQuestionEmbeds(guildId, projected, session, {
						kind: currentMessage.kind,
						liveQuestion: question,
					});
					await discordAPIAma.channels.editMessage(currentMessage.channelId, currentMessage.messageId, {
						embeds: resolveEmbedsForEdit(embeds),
					});
				} catch (error) {
					// A deleted message is the one tolerable failure -- there's nothing left to diverge from.
					if (!isNotFoundDiscordError(error)) {
						throw badGateway('failed to update the posted Discord message; no changes were saved');
					}
				}
			}

			// Written as two statements rather than one setting both columns off the projection above: the read
			// this branch validated against is not held under a lock, so echoing back the flag nobody touched
			// would let this request clobber a concurrent change to it.
			const [updated] =
				'anonymous' in data
					? await db<AmaQuestions[]>`
							UPDATE ama_questions SET anonymous = ${data.anonymous}, updated_at = now()
							WHERE id = ${questionId}
							RETURNING *
						`
					: await db<AmaQuestions[]>`
							UPDATE ama_questions SET show_asker_count = ${data.showAskerCount}, updated_at = now()
							WHERE id = ${questionId}
							RETURNING *
						`;

			// Same concurrent-merge race the answer branch guards against below: the question can be deleted
			// between the read above and this write.
			if (!updated) {
				throw notFound('question not found');
			}

			// Only a real transition counts, matching the bot's own toggle and the bulk route -- re-sending the
			// value a question already has (the dashboard's switch is idempotent) isn't a decision anyone made.
			// Both directions are `anonymize`: what's being recorded is that a moderator set who the question
			// publishes as, not which way they set it. The asker-count toggle records nothing -- it changes what
			// a question says about itself, not a moderation decision about who asked it.
			if ('anonymous' in data && question.anonymous !== data.anonymous) {
				amaModerationDecisions.inc({ decision: 'anonymize', source: 'dashboard' });
			}

			return updated;
		}

		if ('content' in data) {
			// See `contentModeSchema`: a submitted question's wording belongs to whoever typed it into the modal.
			if (!question.umbrella) {
				throw badRequest('only an umbrella question can be reworded');
			}

			// Whichever surface is live gets re-rendered, unlike the anonymity modes above, which only ever
			// change what the *answers* message shows -- both surfaces render the content. In practice an
			// umbrella question only ever reaches the answers channel (`createQuestion.ts` gives it no queue
			// message at all), but keying off the resolved surface rather than assuming that keeps this honest
			// if one ever gains one. Discord-first with the same strictness as #327's answer edit: on anything
			// but a deleted message, save nothing rather than let the dashboard claim wording Discord doesn't
			// show.
			const currentMessage = resolveCurrentQueueMessage(question, session);
			if (currentMessage) {
				try {
					// The row as it's about to be written, with `liveQuestion` left as the stored one -- same split
					// as every other edit branch here, and for the same reason (recovering the question's images
					// reads the message as it exists right now).
					const projected: AmaQuestions = { ...question, content: data.content };
					const embeds = await buildQuestionEmbeds(guildId, projected, session, {
						kind: currentMessage.kind,
						liveQuestion: question,
					});
					await discordAPIAma.channels.editMessage(currentMessage.channelId, currentMessage.messageId, {
						embeds: resolveEmbedsForEdit(embeds),
					});
				} catch (error) {
					if (!isNotFoundDiscordError(error)) {
						throw badGateway('failed to update the posted Discord message; no changes were saved');
					}
				}
			}

			const [updated] = await db<AmaQuestions[]>`
				UPDATE ama_questions SET content = ${data.content}, updated_at = now()
				WHERE id = ${questionId}
				RETURNING *
			`;

			// Same concurrent-deletion race the branches around this one guard against.
			if (!updated) {
				throw notFound('question not found');
			}

			// No `amaModerationDecisions` entry: rewording a question staff wrote themselves is authoring, not a
			// decision about someone else's submission. Same reasoning as the asker-count toggle above.
			return updated;
		}

		if (!('state' in data)) {
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
			// The second half of the same default: `answeredById` above can still resolve to null (field
			// omitted on a question that never had one), and this column is never stored null. Resolved once,
			// here, so the embed rendered below and the row written further down can't disagree about who
			// answered -- projecting the un-defaulted value would footer the Discord embed "Unknown User".
			const effectiveAnsweredById = answeredById ?? req.tokens.access.sub;

			// Editing an answer that already went out (#327) has to reach the message it went out in, or the
			// dashboard and the public answers page would start showing something Discord doesn't. Deliberately
			// *not* best-effort the way `mergeShared.ts`' own re-render is: there the merge had already
			// committed and a failed refresh was cosmetic, whereas here the Discord edit *is* the change, so it
			// runs first and a failure leaves nothing written at all.
			if (question.state === 'ASKED') {
				const currentMessage = resolveCurrentQueueMessage(question, session);

				// No live message to keep in sync (an 'ASKED' row whose post never landed, e.g. the send failed
				// after claiming the state) -- nothing to edit, so just save.
				if (currentMessage) {
					try {
						// The row as it's *about to be* written -- the embed has to show the incoming answer, not
						// the stored one. Inside the try alongside the edit itself: composing these embeds reads
						// the live message back for its attachments, so it's the same "couldn't reach Discord"
						// failure and deserves the same answer.
						const projected: AmaQuestions = {
							...question,
							answerContent,
							answerImageUrl,
							answeredById: effectiveAnsweredById,
						};
						// `liveQuestion` is the stored row: the embeds render from the projection, but recovering
						// the question's existing images has to go off what the live message looks like *now*,
						// which is the pre-edit answer state. See `buildQuestionEmbeds`' own doc on the option.
						const embeds = await buildQuestionEmbeds(guildId, projected, session, {
							kind: currentMessage.kind,
							liveQuestion: question,
						});
						// `resolveEmbedsForEdit` because the question's image urls were read back off the live
						// message -- resending them resolved on a PATCH renders each image twice (see its doc comment).
						await discordAPIAma.channels.editMessage(currentMessage.channelId, currentMessage.messageId, {
							embeds: resolveEmbedsForEdit(embeds),
						});
					} catch (error) {
						// A deleted message is the one tolerable failure: there's no longer anything to diverge
						// from, and refusing the edit would strand the answer as uneditable forever.
						if (!isNotFoundDiscordError(error)) {
							throw badGateway('failed to update the posted Discord message; no changes were saved');
						}
					}
				}
			}

			const [updated] = await db<AmaQuestions[]>`
				UPDATE ama_questions
				SET
					answer_content = ${answerContent},
					answer_image_url = ${answerImageUrl},
					answered_by_id = ${effectiveAnsweredById},
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

			amaModerationDecisions.inc({ decision: 'deny', source: 'dashboard' });
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

			amaModerationDecisions.inc({ decision: 'approve', source: 'dashboard' });
			await markSourceMessageResolved(question, session, ButtonStyle.Success, '✅ Approved - awaiting send');
			return approved;
		}

		// Public-page-only AMA (#316): approving still publishes, just not to Discord -- the question goes
		// straight to 'ASKED' with no `answers_message_id`, and the public answers page (already in this
		// route's `realtimeChannel`) is where it shows up. No message posted means no compensation needed.
		const answersChannelId = session.answersChannelId;
		if (!answersChannelId) {
			const [askedWithoutPost] = await db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'ASKED', asked_at = now(), updated_at = now()
				WHERE id = ${questionId} AND state = 'PENDING_REVIEW'
				RETURNING *
			`;

			if (!askedWithoutPost) {
				throw conflict('this question was already handled by someone else');
			}

			amaModerationDecisions.inc({ decision: 'approve_and_send', source: 'dashboard' });
			await markSourceMessageResolved(question, session, ButtonStyle.Success, '✅ Approved');
			return askedWithoutPost;
		}

		const embeds = await buildQuestionEmbeds(guildId, question, session);
		const message = await discordAPIAma.channels.createMessage(answersChannelId, { embeds });

		const [asked] = await db<AmaQuestions[]>`
			UPDATE ama_questions
			SET state = 'ASKED', answers_message_id = ${message.id}, asked_at = now(), updated_at = now()
			WHERE id = ${questionId} AND state = 'PENDING_REVIEW'
			RETURNING *
		`;

		if (!asked) {
			// eslint-disable-next-line promise/prefer-await-to-then
			void discordAPIAma.channels.deleteMessage(answersChannelId, message.id).catch(() => null);
			throw conflict('this question was already handled by someone else');
		}

		amaModerationDecisions.inc({ decision: 'approve_and_send', source: 'dashboard' });
		await markSourceMessageResolved(question, session, ButtonStyle.Success, '✅ Approved');
		return asked;
	},
});
