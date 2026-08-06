import { getContext } from '@chatsift/backend-core';
import { getAnswerEmbed, getBaseEmbeds } from '@chatsift/core';
import type { AmaQuestionAskers, AmaQuestions, AmaQuestionsId, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';
import { badRequest, conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIAma } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { resolveAmaDisplayName, resolveAmaUser, resolveQuestionAttachments } from './util.js';

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
		isGuildManager: true,
	}),
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

		const extraAskers = await db<AmaQuestionAskers[]>`
			SELECT * FROM ama_question_askers WHERE question_id = ${questionId} ORDER BY merged_at ASC
		`;

		const [attachments, user, extraAskerNames] = await Promise.all([
			resolveQuestionAttachments(question, session),
			resolveAmaUser(guildId, question.authorId),
			Promise.all(extraAskers.map(async (row) => resolveAmaDisplayName(guildId, row.authorId))),
		]);

		const embeds = getBaseEmbeds({
			attachments,
			content: question.content,
			extraAskerDisplayNames: extraAskerNames,
			guildId,
			user: typeof user === 'string' ? undefined : user,
		});

		if (question.answerContent) {
			const answeredByUser = question.answeredById ? await resolveAmaUser(guildId, question.answeredById) : undefined;
			const answeredByDisplayName =
				typeof answeredByUser === 'string' || !answeredByUser
					? (question.answeredById ?? 'Unknown User')
					: (answeredByUser.global_name ?? answeredByUser.username);
			const answeredByAvatarURL =
				typeof answeredByUser === 'object' && answeredByUser?.avatar
					? `${RouteBases.cdn}${CDNRoutes.userAvatar(answeredByUser.id, answeredByUser.avatar, ImageFormat.PNG)}`
					: undefined;

			embeds.push(
				getAnswerEmbed({
					answerContent: question.answerContent,
					answerImageUrl: question.answerImageUrl,
					answeredByAvatarURL,
					answeredByDisplayName,
				}),
			);
		}

		const message = await discordAPIAma.channels.createMessage(session.answersChannelId, { embeds });

		const [sent] = await db<AmaQuestions[]>`
			UPDATE ama_questions
			SET state = 'ASKED', answers_message_id = ${message.id}, updated_at = now()
			WHERE id = ${questionId} AND state = 'APPROVED'
			RETURNING *
		`;

		if (!sent) {
			// eslint-disable-next-line promise/prefer-await-to-then
			void discordAPIAma.channels.deleteMessage(session.answersChannelId, message.id).catch(() => null);
			throw conflict('this question was already sent');
		}

		return sent;
	},
});
