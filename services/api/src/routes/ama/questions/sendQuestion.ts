import { getContext } from '@chatsift/backend-core';
import { amaPublicAnswersChannel, amaQuestionsChannel } from '@chatsift/core';
import type { AmaQuestions, AmaQuestionsId, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { badRequest, conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { amaModerationDecisions } from '../../../core/metrics.js';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIAma } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildQuestionEmbeds } from './util.js';

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

export type SendQuestionResult = AmaQuestions;

export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/questions/:questionId/send',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: 'or-ama-guest',
	}),
	// Two audiences: the dashboard's question list, and the public answers page (#323) -- sending is exactly
	// the transition that makes a question show up there (`ASKED` with an answer recorded).
	realtimeChannel: (req) => [
		amaQuestionsChannel(req.params.guildId, req.params.amaId),
		amaPublicAnswersChannel(req.params.amaId),
	],
	async handler(req): Promise<SendQuestionResult> {
		const { guildId, amaId, questionId } = req.params;
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

		if (question.state !== 'APPROVED') {
			throw badRequest(`cannot send a question in state ${question.state}; it must be APPROVED first`);
		}

		// Public-page-only AMA (#316): there's no channel to publish to, so "send" is purely the state
		// transition -- the question becomes visible on `/ama-answers/:shareToken` (which this route already
		// invalidates below) and `answers_message_id` stays null. No message means nothing to compensate
		// for either, so the claim runs on its own.
		const answersChannelId = session.answersChannelId;
		if (!answersChannelId) {
			const [sentWithoutPost] = await db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'ASKED', asked_at = now(), updated_at = now()
				WHERE id = ${questionId} AND state = 'APPROVED'
				RETURNING *
			`;

			if (!sentWithoutPost) {
				throw conflict('this question was already sent');
			}

			amaModerationDecisions.inc({ decision: 'approve_and_send', source: 'dashboard' });
			return sentWithoutPost;
		}

		const embeds = await buildQuestionEmbeds(guildId, question, session);
		const message = await discordAPIAma.channels.createMessage(answersChannelId, { embeds });

		let sent: AmaQuestions | undefined;
		try {
			[sent] = await db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'ASKED', answers_message_id = ${message.id}, asked_at = now(), updated_at = now()
				WHERE id = ${questionId} AND state = 'APPROVED'
				RETURNING *
			`;
		} catch (error) {
			// The message is already publicly visible at this point -- if the DB write itself throws (not just
			// resolves empty), leaving it up would silently publish a question that was never actually claimed
			// as ASKED. Mirrors `createAMA.ts`'s own delete-on-failure compensation.
			// eslint-disable-next-line promise/prefer-await-to-then
			void discordAPIAma.channels.deleteMessage(answersChannelId, message.id).catch(() => null);
			throw error;
		}

		if (!sent) {
			// eslint-disable-next-line promise/prefer-await-to-then
			void discordAPIAma.channels.deleteMessage(answersChannelId, message.id).catch(() => null);
			throw conflict('this question was already sent');
		}

		amaModerationDecisions.inc({ decision: 'approve_and_send', source: 'dashboard' });
		return sent;
	},
});
