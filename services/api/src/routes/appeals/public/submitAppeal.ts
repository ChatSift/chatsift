import { appealsQueueChannel, getContext, publishRealtimeInvalidate } from '@chatsift/backend-core';
import type { AppealAnswers, Appeals } from '@chatsift/db';
import { badRequest, conflict } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAppealsAuthed } from '../../../middleware/isAppealsAuthed.js';
import { postAppealCard } from '../../../util/appealCard.js';
import type { AppealBlockReason } from '../../../util/appealsEligibility.js';
import { APPEAL_KIND_BAN, evaluateAppealEligibility } from '../../../util/appealsEligibility.js';
import type { PublicAppeal } from '../../../util/appealsPublic.js';
import { toPublicAppeal } from '../../../util/appealsPublic.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { submitAppealBodySchema } from '../schemas.js';

const bodySchema = submitAppealBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type SubmitAppealBody = z.input<typeof bodySchema>;

/**
 * What each refusal reads as to the appellant. Written out per reason rather than echoing the enum, because
 * this is the copy somebody having a bad day actually sees -- and because `'UNAPPEALABLE'` must say nothing
 * beyond the fact of it (decision 8) and `'ALREADY_OPEN'` has to read identically for a genuinely pending
 * appeal and a silent denial (decision 6).
 */
const BLOCK_MESSAGES: Record<AppealBlockReason, string> = {
	ALREADY_OPEN: 'you already have an appeal under review in this server',
	COOLDOWN: 'you cannot appeal in this server again yet',
	MAX_APPEALS: 'you have used all of your appeals in this server',
	NOT_BANNED: 'you are not banned in this server',
	NOT_CONFIGURED: 'that server does not accept appeals here',
	PROBE_UNAVAILABLE: 'we could not check your ban in that server right now, please try again later',
	UNAPPEALABLE: 'you cannot appeal in this server',
};

export default defineRoute({
	method: 'post',
	path: '/v3/appeals/guilds/:guildId/appeals',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAppealsAuthed({ fallthrough: false }),
	async handler(req): Promise<PublicAppeal> {
		const { guildId } = req.params;
		const { sub } = req.appellant;
		const db = getContext().db;

		// Re-run in full rather than trusting whatever `checkGuild` told the browser minutes ago -- including the
		// ban probe, which is the authority (#232 §4: correctness only has to hold here). An appellant unbanned,
		// listed as unappealable, or already at their ceiling since the form rendered is refused at this line.
		const eligibility = await evaluateAppealEligibility(guildId, sub, APPEAL_KIND_BAN, req.logger);
		if (eligibility.blocked) {
			throw badRequest(BLOCK_MESSAGES[eligibility.blocked]);
		}

		const questions = eligibility.questions;
		const answersById = new Map(req.body.answers.map((answer) => [answer.questionId, answer.answer]));

		for (const questionId of answersById.keys()) {
			if (!questions.some((question) => question.id === questionId)) {
				throw badRequest('one of the submitted answers does not belong to the appeal form for this server');
			}
		}

		const answers = questions.map((question) => ({
			position: question.position,
			promptSnapshot: question.prompt,
			answer: answersById.get(question.id)?.trim() ?? '',
		}));

		const missing = questions.filter((question) => question.required && !(answersById.get(question.id)?.trim() ?? ''));
		if (missing.length) {
			throw badRequest('please answer every required question');
		}

		let filed: { appeal: Appeals; rows: AppealAnswers[] };

		try {
			filed = await db.begin(async (tx) => {
				const [appeal] = await tx<Appeals[]>`
					INSERT INTO appeals (guild_id, user_id, kind, reason_snapshot, rejoin_consent)
					VALUES (${guildId}, ${sub}, 'BAN', ${eligibility.probe?.banReason ?? null}, ${req.body.rejoinConsent})
					RETURNING *
				`;

				// Unanswered optional questions are still written, with their prompt and an empty answer, so the
				// mod-side embed renders the guild's whole form rather than silently omitting the questions
				// nobody filled in -- "they declined to answer this" is information a moderator wants.
				const rows = await tx<AppealAnswers[]>`
					INSERT INTO appeal_answers ${tx(answers.map((answer) => ({ appealId: appeal!.id, ...answer })))}
					RETURNING *
				`;

				await tx`
					INSERT INTO appeal_events (appeal_id, kind, actor_id)
					VALUES (${appeal!.id}, 'SUBMITTED', ${sub})
				`;

				return { appeal: appeal!, rows };
			});
		} catch (error) {
			// `appeals_open_per_user_idx`. The eligibility check above already refuses a second open appeal, so
			// reaching this means two submits raced -- `unban.app` is a public form for hostile users by
			// construction, and the partial unique index is what makes that impossible rather than unlikely. The
			// loser is told the same thing the check would have told them.
			if (error instanceof Error && 'code' in error && error.code === '23505') {
				throw conflict(BLOCK_MESSAGES.ALREADY_OPEN);
			}

			throw error;
		}

		// Both after the commit, and in this order. The card is a Discord side effect that must not be able to
		// roll the appeal back (#232 P4 -- it is best-effort by construction and swallows its own failures), and
		// the queue invalidate is what puts the appeal in front of a moderator who has P5's dashboard open.
		await postAppealCard(filed.appeal, filed.rows);
		await publishRealtimeInvalidate(appealsQueueChannel(guildId));

		return toPublicAppeal(filed.appeal, answers);
	},
});
