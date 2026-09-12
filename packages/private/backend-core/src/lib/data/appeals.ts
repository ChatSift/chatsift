import type { AppealAnswerInput, AppealEmbedInput, AppealStatusName } from '@chatsift/core';
import { appealsQueueChannel } from '@chatsift/core';
import type {
	AppealAnswers,
	AppealEventKind,
	AppealEvents,
	AppealKind,
	Appeals,
	AppealsId,
	AppealsSettings,
	AppealStatus,
} from '@chatsift/db';
import { getContext } from '../context.js';
import { publishRealtimeInvalidate } from '../realtimeBroadcast.js';

/**
 * The appeal decision spine, shared by `services/appeals-bot` (the three buttons on the mod-channel card, P4)
 * and `services/api` (the same three actions from the dashboard, P5). Decision 1 of #232 is that both mod
 * surfaces exist from the start and converge on **one** transition rather than two that drift, and this is it.
 *
 * Deliberately owns **no Discord side effect** of its own, exactly like `automoderatorReports.ts`: posting and
 * rewriting the card is each surface's job, through the builders in `@chatsift/core`. The one effect that is
 * genuinely shared -- the unban an approval performs -- is injected as a callback,
 * because ordering it correctly against the compare-and-swap is the part worth having in one place, and this
 * package cannot depend on `@discordjs/rest` to do it itself. See `perform` on
 * `ApplyAppealDecisionOptions`.
 */

/**
 * Runtime values for `appeal_status` and `appeal_event_kind`, which kanel generates as TypeScript enums that
 * `@chatsift/db` only re-exports the *type* of -- so there is nothing to compare against without this. Same
 * arrangement as `automoderatorReports.ts`'s `REPORT_STATE`.
 */
export const APPEAL_STATUS = {
	PENDING: 'PENDING' as AppealStatus,
	APPROVED: 'APPROVED' as AppealStatus,
	DENIED: 'DENIED' as AppealStatus,
	WITHDRAWN: 'WITHDRAWN' as AppealStatus,
	MOOT: 'MOOT' as AppealStatus,
} as const satisfies Record<string, AppealStatus>;

export const APPEAL_EVENT = {
	SUBMITTED: 'SUBMITTED' as AppealEventKind,
	APPROVED: 'APPROVED' as AppealEventKind,
	DENIED: 'DENIED' as AppealEventKind,
	WITHDRAWN: 'WITHDRAWN' as AppealEventKind,
	MOOT: 'MOOT' as AppealEventKind,
	NOTE: 'NOTE' as AppealEventKind,
	// Not a decision and not something a person did: P6 writing down what became of one (`appealDelivery.ts`).
	DELIVERY: 'DELIVERY' as AppealEventKind,
} as const satisfies Record<string, AppealEventKind>;

/**
 * Which audit row a decision writes.
 *
 * Enumerated rather than casting the status across. The two enums overlap only by coincidence, `PENDING` has
 * no event kind at all, and a status added later should land here as a thrown error on the first decision
 * rather than as an event kind that does not exist.
 */
const DECISION_EVENTS: Record<string, AppealEventKind | undefined> = {
	APPROVED: APPEAL_EVENT.APPROVED,
	DENIED: APPEAL_EVENT.DENIED,
	WITHDRAWN: APPEAL_EVENT.WITHDRAWN,
	MOOT: APPEAL_EVENT.MOOT,
};

function decisionEventKind(status: AppealStatus): AppealEventKind {
	const kind = DECISION_EVENTS[status as unknown as string];
	if (!kind) {
		throw new RangeError(`${String(status)} is not a decision an appeal can be moved to`);
	}

	return kind;
}

/**
 * Structurally identical to the bot's `CaseActor`, redeclared rather than imported: a service cannot be a
 * dependency of a package.
 */
export interface AppealActor {
	readonly id: string;
	readonly tag: string;
}

export async function getAppeal(id: AppealsId | number): Promise<Appeals | null> {
	const [row] = await getContext().db<Appeals[]>`
		SELECT * FROM appeals WHERE id = ${id}
	`;

	return row ?? null;
}

export async function listAppealAnswers(id: AppealsId | number): Promise<AppealAnswers[]> {
	return getContext().db<AppealAnswers[]>`
		SELECT * FROM appeal_answers WHERE appeal_id = ${id} ORDER BY position ASC
	`;
}

/**
 * The appeal that currently holds this user's `appeals_open_per_user_idx` slot in this guild, if any.
 *
 * Scoped to `PENDING` rather than to `appearsOpenToAppellant`: a silent denial looks open to the appellant but
 * is terminal, and closing one as moot would overwrite a decision a moderator deliberately made.
 */
export async function getOpenAppeal(guildId: string, userId: string, kind: AppealKind): Promise<Appeals | null> {
	const [row] = await getContext().db<Appeals[]>`
		SELECT * FROM appeals
		WHERE guild_id = ${guildId} AND user_id = ${userId} AND kind = ${kind} AND status = ${APPEAL_STATUS.PENDING}
	`;

	return row ?? null;
}

export async function getAppealsSettings(guildId: string): Promise<AppealsSettings | null> {
	const [row] = await getContext().db<AppealsSettings[]>`
		SELECT * FROM appeals_settings WHERE guild_id = ${guildId}
	`;

	return row ?? null;
}

/**
 * Narrows a row to the structural shape `@chatsift/core`'s card builders take. Here rather than at each card
 * poster because both services post cards, and two copies of the `status` cast is two places for it to drift.
 */
export function appealEmbedInput(appeal: Appeals): AppealEmbedInput {
	return { ...appeal, status: appeal.status as unknown as AppealStatusName };
}

export function appealAnswerInputs(answers: readonly AppealAnswers[]): AppealAnswerInput[] {
	return answers.map((answer) => ({
		position: answer.position,
		promptSnapshot: answer.promptSnapshot,
		answer: answer.answer,
	}));
}

/**
 * Remembers where the card was posted, so it is edited in place for the life of the appeal rather than
 * re-posted (decision 13). `null` forgets it, which is what a card whose channel or message has been deleted
 * gets -- the next write posts fresh instead of failing forever against a dead id.
 *
 * `channelId` is where the *message* is: the forum post itself when the guild posts appeals to a forum, and the
 * mod channel when it posts to a text channel with a thread hanging off the card. Stored rather than derived at
 * edit time, because `appeals_settings.mod_channel_id` can change while appeals are open and every open card
 * would then be edited in the wrong channel.
 */
export async function setAppealModMessage(
	id: AppealsId | number,
	card: { channelId: string; messageId: string; threadId: string | null } | null,
): Promise<void> {
	await getContext().db`
		UPDATE appeals SET
			mod_channel_id = ${card?.channelId ?? null},
			mod_message_id = ${card?.messageId ?? null},
			mod_thread_id = ${card?.threadId ?? null}
		WHERE id = ${id}
	`;
}

export async function recordAppealEvent(
	id: AppealsId | number,
	kind: AppealEventKind,
	options: { actorId?: string | null; body?: string | null } = {},
): Promise<void> {
	await getContext().db`
		INSERT INTO appeal_events (appeal_id, kind, actor_id, body)
		VALUES (${id}, ${kind}, ${options.actorId ?? null}, ${options.body ?? null})
	`;
}

export async function listAppealEvents(id: AppealsId | number): Promise<AppealEvents[]> {
	return getContext().db<AppealEvents[]>`
		SELECT * FROM appeal_events WHERE appeal_id = ${id} ORDER BY id ASC
	`;
}

/**
 * Why a decision did not land. `raced` is somebody else deciding first and is an ordinary outcome, not an
 * error; `failed` means the row was claimed, the side effect threw, and the claim has been given back.
 */
export type AppealDecisionFailure = 'failed' | 'raced';

export type AppealDecisionResult =
	{ appeal: Appeals; ok: true } | { error?: unknown; ok: false; reason: AppealDecisionFailure };

export interface ApplyAppealDecisionOptions {
	readonly appealId: AppealsId | number;
	/**
	 * Who decided. `null` only for a withdrawal, which is the appellant's own action and the one terminal
	 * state `appeals_decision_check` allows no `decided_by_id` on.
	 */
	readonly moderator: AppealActor | null;
	/**
	 * The Discord half of the decision, run **after** the row is claimed and **before** the event is written.
	 * Today that is the unban an approval performs; a denial has none and passes nothing.
	 *
	 * Throwing from here gives the claim back: the appeal returns to `PENDING` with its decision columns
	 * cleared, no `appeal_events` row is written, and the caller gets `{ ok: false, reason: 'failed' }`. That
	 * ordering is the whole reason this is a callback rather than something each surface does around the call
	 * -- an appeal left `APPROVED` over a failed unban tells the appellant, in P6's DM, that they may come back
	 * to a server that still has them banned.
	 */
	perform?(appeal: Appeals): Promise<void>;
	/**
	 * Mod-facing on a silent denial, appellant-facing on an ordinary one (it is what P6's DM will say). Which
	 * audience it has is decided entirely by `silent`.
	 */
	readonly reason?: string | null;
	/**
	 * Decision 6. Only ever true alongside `DENIED` -- `appeals_silent_check` rejects anything else, which is
	 * the database saying an approval the appellant cannot see would be a bug that reads as a feature.
	 */
	readonly silent?: boolean;
	readonly status: AppealStatus;
}

/**
 * The one appeal transition. Compare-and-swap from `PENDING`, then the side effect, then the audit row.
 *
 * **The claim is the mutex**, and it is a conditional write rather than a check beforehand: a card can sit on
 * screen for as long as somebody leaves it there, and a modal for five minutes, so the status a handler read is
 * a claim about the past by the time it writes. Narrowing that window is not the same as closing it -- without
 * the `WHERE status = 'PENDING'`, two moderators clicking opposite buttons both write, and the appellant ends
 * up unbanned against a row that says denied.
 *
 * Every decision is terminal: there is no path back to `PENDING` except the rollback below, which exists only
 * because a claim whose side effect failed was never a decision at all.
 */
export async function applyAppealDecision(options: ApplyAppealDecisionOptions): Promise<AppealDecisionResult> {
	const db = getContext().db;
	const silent = options.silent ?? false;

	const [claimed] = await db<Appeals[]>`
		UPDATE appeals SET
			status = ${options.status},
			silent = ${silent},
			decided_at = now(),
			decided_by_id = ${options.moderator?.id ?? null},
			decision_reason = ${options.reason ?? null}
		WHERE id = ${options.appealId} AND status = ${APPEAL_STATUS.PENDING}
		RETURNING *
	`;

	if (!claimed) {
		return { ok: false, reason: 'raced' };
	}

	if (options.perform) {
		try {
			await options.perform(claimed);
		} catch (error) {
			// Given back rather than left claimed. Unconditional on the current status because only this function
			// ever leaves `PENDING`, so nothing can have moved it in between -- and if something somehow did, the
			// `WHERE` below is what stops this from trampling it.
			await db`
				UPDATE appeals SET
					status = ${APPEAL_STATUS.PENDING},
					silent = false,
					decided_at = NULL,
					decided_by_id = NULL,
					decision_reason = NULL
				WHERE id = ${options.appealId} AND status = ${options.status}
			`;

			return { ok: false, reason: 'failed', error };
		}
	}

	await recordAppealEvent(claimed.id, decisionEventKind(options.status), {
		actorId: options.moderator?.id ?? null,
		body: options.reason ?? null,
	});

	// Both mod surfaces read the same queue, and only one of them is the surface the decision came from.
	await publishRealtimeInvalidate(appealsQueueChannel(claimed.guildId));

	return { ok: true, appeal: claimed };
}
