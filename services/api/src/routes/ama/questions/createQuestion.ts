import { getContext } from '@chatsift/backend-core';
import { amaQuestionsChannel } from '@chatsift/core';
import type { AmaQuestions, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const bodySchema = z.strictObject({
	// #366: an umbrella question is written by staff, so it skips the submit modal's own 15-character floor
	// (that exists to stop "hi" reaching the queue) but keeps the same 4,000-character ceiling.
	content: z.string().trim().min(1).max(4_000),
	// Whether the published question carries its merged-asker tally ("Asked by N people"). No `anonymous`
	// alongside it: an umbrella question never publishes an author, so there was nothing to choose between.
	showAskerCount: z.boolean().optional(),
});
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
});

export type CreateQuestionBody = z.input<typeof bodySchema>;
export type CreateQuestionResult = AmaQuestions;

/**
 * Creates an "umbrella question" (#366): one staff writes themselves, worded the way they want it answered,
 * that the real duplicates then get merged into so the tally ("Asked by -- N people", #326) lands on wording
 * nobody has to apologise for. Every other question in the system arrives through the bot's submit
 * modal; this is the only way to author one directly.
 *
 * It lands as `APPROVED` regardless of the session's review/prepared-answer settings. `PENDING_REVIEW` would
 * ask staff to review their own question (and there's no queue message for the Discord buttons to live on --
 * this row deliberately has no `queue_message_id`), while going straight to `ASKED` would publish it the
 * instant it was typed, before anything could be merged into it. `APPROVED` is also a `MERGE_TARGET_STATE`,
 * so duplicates can be folded in immediately, and the dashboard's existing Send action publishes it when the
 * host is ready -- the same path a prepared answer takes.
 *
 * `author_id` is the dashboard user creating it. That's who actually wrote it, and it keeps every author
 * lookup downstream working unchanged -- but they didn't *ask* it, so the audience never sees them: the row
 * is created `umbrella`, which forces the same author-less rendering `anonymous` does and additionally makes
 * the merged-asker tally count the merges alone rather than "N other people" than an author nobody can see.
 * `anonymous` is set to match rather than left false, so the many read paths that only know about that flag
 * (the CSV export, the dashboard's own chips) stay correct without each having to learn about umbrella.
 *
 * The one choice the form offers is `show_asker_count`: the tally is the only thing a published umbrella
 * question can say about who asked it, so hiding it publishes the question and nothing else.
 */
export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/questions',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: 'or-ama-guest',
	}),
	// Only the dashboard's question list: an `APPROVED` question isn't on the public answers page yet (that
	// needs `ASKED` plus an answer), and Send publishes on `amaPublicAnswersChannel` when it gets there.
	realtimeChannel: (req) => amaQuestionsChannel(req.params.guildId, req.params.amaId),
	async handler(req): Promise<CreateQuestionResult> {
		const { guildId, amaId } = req.params;
		const { content, showAskerCount = true } = req.body;
		const db = getContext().db;

		// No `ended` guard, matching the bot's own approve path: ending an AMA stops new *submissions* (#299)
		// and leaves everything already in the queue reviewable and answerable. An umbrella question is part of
		// that answering work, not a submission.
		const [session] = await db<Pick<AmaSessions, 'id'>[]>`
			SELECT id FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		const [question] = await db<AmaQuestions[]>`
			INSERT INTO ama_questions (ama_id, author_id, state, content, anonymous, umbrella, show_asker_count)
			VALUES (${amaId}, ${req.tokens.access.sub}, 'APPROVED', ${content}, true, true, ${showAskerCount})
			RETURNING *
		`;

		return question!;
	},
});
