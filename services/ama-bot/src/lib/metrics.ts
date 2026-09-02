import { Counter, Registry } from 'prom-client';

/**
 * Dedicated registry rather than prom-client's process-wide default, mirroring `automoderator-bot`'s
 * `lib/metrics.ts` and `services/api`'s `core/metrics.ts` (#277).
 *
 * **Collection is unconditional; only exposure is gated** (see `@chatsift/bot-core`'s `metricsServer.ts`).
 *
 * **Cardinality discipline, non-negotiable:** never label by `guild_id`, `user_id`, `channel_id`, `message_id`,
 * or question content. Every label below is drawn from a closed set known at compile time. Per-AMA questions are
 * `GET /v3/guilds/:guildId/ama/amas/:amaId/stats`'s job, not this endpoint's.
 *
 * **Two of these names are also defined in `services/api`'s registry**, with `source="dashboard"` instead of
 * `source="bot"` -- see `services/api/src/core/metrics.ts`. That is deliberate: the dashboard is AMA's primary
 * moderation surface, so a bot-only counter would read as "moderation stopped" for a guild that triages on the
 * web. Grafana sums across the two jobs. Keep the label sets identical or the sum silently splits.
 */
export const register = new Registry();

/**
 * Questions submitted through the modal. `initial_state` is the state the row was created in, which
 * `submitQuestion.ts` derives from the session's own config -- `review_enabled` sends it to the queue,
 * `prepared_answers_enabled` holds it as approved, and neither means it goes straight out as asked.
 *
 * So this counter also reports *how guilds are configured*, in aggregate, without a per-guild label: a
 * deployment where `pending_review` is flat at zero has no guild running review, which is worth knowing before
 * concluding the queue is broken.
 */
export const questionsSubmitted = new Counter({
	name: 'ama_questions_submitted_total',
	help: 'Questions submitted, by the state they were filed in and whether the write succeeded',
	labelNames: ['initial_state', 'result'] as const,
	registers: [register],
});

/**
 * Moderation decisions on a question. `approve` leaves it staged for a later send; `approve_and_send` publishes
 * it in one step; `merge` folds a duplicate into an existing question, destroying its row.
 *
 * `source` is `bot` here and `dashboard` in the API's copy of this metric. Both halves are needed for the total
 * to mean anything -- see the registry comment above.
 */
export const moderationDecisions = new Counter({
	name: 'ama_moderation_decisions_total',
	help: 'Moderation decisions on questions, by decision and which surface made it',
	labelNames: ['decision', 'source'] as const,
	registers: [register],
});

/**
 * Session-level transitions. `source` separates a moderator running `/ama close` from the sweep firing a
 * `scheduled_close_at`, which is the difference between "someone ended it" and "the schedule worked".
 *
 * A guild that sets scheduled closes and never sees `closed{source="scheduled"}` has a stopped sweep, and the
 * user-visible symptom -- an AMA that never ends -- gives no hint where to look.
 */
export const sessionTransitions = new Counter({
	name: 'ama_session_transitions_total',
	help: 'AMA session transitions, by what happened and what caused it',
	labelNames: ['transition', 'source'] as const,
	registers: [register],
});

/**
 * A guarded `UPDATE ... WHERE state = 'PENDING_REVIEW'` that matched no rows: two moderators pressed
 * approve/deny on the same queue card, and the second one lost. The loser is told so and nothing is
 * double-applied, so this is **correct behaviour being counted, not an error** -- but it is currently silent,
 * and a guild where it climbs has a queue two people are fighting over.
 */
export const claimRaces = new Counter({
	name: 'ama_claim_races_total',
	help: 'Guarded question-state claims that found the row already claimed',
	labelNames: ['action'] as const,
	registers: [register],
});

/**
 * prom-client emits no series for a label combination until it is first incremented, so a counter that has
 * legitimately never fired reads as "No data" rather than `0`. See the fuller note in `modmail-bot`'s
 * `lib/metrics.ts`.
 */
function zeroInitialise(): void {
	for (const initialState of ['pending_review', 'approved', 'asked']) {
		for (const result of ['ok', 'failed']) {
			questionsSubmitted.inc({ initial_state: initialState, result }, 0);
		}
	}

	for (const decision of ['approve', 'approve_and_send', 'deny', 'merge']) {
		moderationDecisions.inc({ decision, source: 'bot' }, 0);
	}

	for (const transition of ['closed', 'prompt_reposted']) {
		for (const source of ['command', 'scheduled']) {
			sessionTransitions.inc({ transition, source }, 0);
		}
	}

	for (const action of ['approve', 'deny']) {
		claimRaces.inc({ action }, 0);
	}
}

zeroInitialise();
