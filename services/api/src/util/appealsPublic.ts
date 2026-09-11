import type { AppealKind, Appeals, AppealStatus } from '@chatsift/db';

/**
 * The same union as `AppealStatus`, but `'DENIED'` here can only ever mean a *non-silent* denial -- a silent one
 * (decision 6) reads as `'PENDING'`, indefinitely. Aliased rather than narrowed because the narrowing is a
 * property of how the value was produced, not of the type: only {@link toPublicAppeal} may mint one.
 */
export type PublicAppealStatus = AppealStatus;

export interface PublicAppealAnswer {
	answer: string;
	position: number;
	/**
	 * The prompt as it read when they answered it (decision 7), not the guild's current wording -- so a
	 * questionnaire edited after the fact never rewrites what somebody was asked.
	 */
	promptSnapshot: string;
}

export interface PublicAppeal {
	answers: PublicAppealAnswer[];
	createdAt: Date;
	guildId: string;
	id: number;
	kind: AppealKind;
	status: PublicAppealStatus;
}

/**
 * **The single choke point for everything an appellant is ever shown about their own appeal** (#232 §5). Every
 * appellant-facing response goes through here; nothing serializes an `appeals` row for `unban.app` by hand.
 *
 * Two rules, and both are one-line mistakes away from being broken silently:
 *
 * 1. **A silent denial reads as pending, forever.** `status = 'DENIED' AND silent` maps back to `'PENDING'`.
 *    Terminal and closed on the moderator's side, publicly indistinguishable from an appeal still being looked
 *    at. That is the entire feature, and it is the reason this function exists rather than a `select` list.
 * 2. **`decided_at`, `decided_by_id` and `decision_reason` never leave the API.** Not "not for silent denials"
 *    -- never, for any status. A denial reason is written for other moderators; who decided is nobody's
 *    business but the guild's; and a `decided_at` on an appeal reading "pending" would give the silent denial
 *    away by itself, which is exactly the leak nothing else in the stack would catch.
 *
 * The return object is built field by field rather than spread-and-delete on purpose: a spread means a column
 * added to `appeals` next year is exposed by default and has to be remembered *out*, which is the wrong
 * direction for a table whose whole point is that half of it is confidential.
 *
 * `appeal_events` has no serializer here and never will -- no appellant-facing route reads that table at all.
 */
export function toPublicAppeal(appeal: Appeals, answers: PublicAppealAnswer[] = []): PublicAppeal {
	return {
		id: appeal.id,
		guildId: appeal.guildId,
		kind: appeal.kind,
		// The cast is the repo-wide shape for kanel's generated enums, which are exported as types only
		// (`packages/private/db/src/index.ts`) -- there is no `AppealStatus.PENDING` value to reach for.
		status: appeal.status === 'DENIED' && appeal.silent ? ('PENDING' as PublicAppealStatus) : appeal.status,
		createdAt: appeal.createdAt,
		answers,
	};
}

/**
 * Whether an appeal is still open on the *moderator's* side: it is in the queue, and it holds the
 * `appeals_open_per_user_idx` slot that makes a double submit impossible at the database level.
 */
export function isAppealOpen(appeal: Pick<Appeals, 'status'>): boolean {
	return appeal.status === 'PENDING';
}

/**
 * Whether an appeal still looks open *to the appellant*, which is the question every appellant-facing refusal
 * has to ask instead of {@link isAppealOpen}.
 *
 * The two differ on exactly one case, and it is the one that matters: a silent denial is closed, is not covered
 * by `appeals_open_per_user_idx`, and would therefore let the appellant file a fresh appeal -- at which point
 * the cooldown check ("you may appeal again in 27 days") would tell them, in so many words, that a decision had
 * been made. Refusing with the same "you already have an appeal under review" a genuinely pending appeal gets is
 * what keeps a silent denial silent past the moment it is made.
 *
 * Derived from {@link toPublicAppeal}'s own mapping rather than restating it, so the two cannot drift.
 */
export function appearsOpenToAppellant(appeal: Appeals): boolean {
	return toPublicAppeal(appeal).status === 'PENDING';
}

/**
 * Whether this appeal ended with the ban it was about being **lifted** -- so the punishment it belongs to is
 * over, whatever happens to that account later.
 *
 * Exactly two statuses qualify, and both mean the same thing on Discord's side: `APPROVED` is the unban the
 * approval performed, and `MOOT` is a ban lifted by some other route while the appeal sat open (P4b). A
 * `DENIED` appeal leaves the ban standing and a `WITHDRAWN` one never touched it, so neither ends anything --
 * which is what keeps a cooldown attached to the ban that earned it, and withdraw-and-resubmit from being a way
 * around one.
 */
export function endedThePunishment(appeal: Pick<Appeals, 'status'>): boolean {
	return appeal.status === 'APPROVED' || appeal.status === 'MOOT';
}

/**
 * The appeals that belong to the punishment an appellant is under **now**, given their whole history in one
 * guild, newest first.
 *
 * `appeals` has no column naming the ban an appeal is about -- Discord's ban object carries no id and no
 * timestamp, and the audit log would need a permission Appeals does not ask for. What it does have is
 * {@link endedThePunishment}: an appeal that ended with the ban being lifted is a boundary, because a ban the
 * account is under *after* that one cannot be the one that appeal was about. Everything newer than the most
 * recent such appeal is this punishment's history; everything at or before it belongs to a ban that is over.
 *
 * Without this, an account that appealed, was approved, and was then banned again arrived back on `unban.app`
 * to find its previous appeal captioned as the current one, `appeals_used` already spent, and a cooldown
 * counting down from a decision about a ban that no longer existed -- while the copy on both blocks promises
 * "the same ban". The ceiling was always specified per (user, punishment); this is the part that was missing.
 */
export function appealsForCurrentPunishment<TAppeal extends Pick<Appeals, 'status'>>(
	newestFirst: readonly TAppeal[],
): TAppeal[] {
	const boundary = newestFirst.findIndex((appeal) => endedThePunishment(appeal));
	return boundary === -1 ? [...newestFirst] : newestFirst.slice(0, boundary);
}
