import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AppealKind, AppealQuestions, Appeals, AppealsSettings, UnappealableUsers } from '@chatsift/db';
import type { Snowflake } from '@discordjs/core';
import type { AppealBanProbe } from './appealsBans.js';
import { probeGuildBan } from './appealsBans.js';
import { appealsForCurrentPunishment, appearsOpenToAppellant } from './appealsPublic.js';

/**
 * The only punishment kind the product serves today. A named constant rather than an inline `'BAN'` at each
 * call site for two reasons: kanel exports `AppealKind` as a type only (see
 * `packages/private/db/src/index.ts`), so every literal would otherwise carry the same cast, and P9 adding
 * timeouts should start from a search for this name rather than for a string that also appears in SQL.
 */
export const APPEAL_KIND_BAN = 'BAN' as AppealKind;

/**
 * Why an appellant cannot file an appeal in this guild right now. `null` (i.e. absent) is the only state the
 * submit form renders in.
 *
 * Each value is something the appellant is actually told, so the set is deliberately coarse where being precise
 * would leak: `UNAPPEALABLE` never carries the moderator's reason (decision 8 -- they are told they cannot
 * appeal, never why), and `ALREADY_OPEN` covers a silent denial as well as a genuinely pending appeal (decision
 * 6 -- see `appearsOpenToAppellant`).
 */
export type AppealBlockReason =
	'ALREADY_OPEN' | 'COOLDOWN' | 'MAX_APPEALS' | 'NOT_BANNED' | 'NOT_CONFIGURED' | 'PROBE_UNAVAILABLE' | 'UNAPPEALABLE';

export interface AppealEligibility {
	/**
	 * How many appeals this appellant has filed **against the ban they are under now**, against
	 * `settings.maxAppeals`. Shown even when nothing is blocking, so somebody on their last attempt knows it
	 * before they write it.
	 *
	 * Not their whole history here: an earlier ban that was lifted took its appeals with it
	 * (`appealsForCurrentPunishment`), which is what the ceiling was always specified to mean and what the
	 * appellant is told it means.
	 */
	appealsUsed: number;
	blocked: AppealBlockReason | null;
	/**
	 * When `blocked` is `'COOLDOWN'`, when it lifts. `null` otherwise.
	 */
	cooldownUntil: Date | null;
	/**
	 * The appeal this page is about, or `null`. **Internal shape** -- callers must run it through
	 * `toPublicAppeal` before it reaches a response.
	 *
	 * Their most recent appeal against the ban they are under now. Where they are *not* banned it falls back to
	 * the appeal that ended their last one, because for somebody checking back after an approval that is the
	 * whole story -- but a fresh ban is never captioned with it.
	 */
	latestAppeal: Appeals | null;
	probe: AppealBanProbe | null;
	questions: AppealQuestions[];
	settings: AppealsSettings | null;
}

/**
 * Everything that decides whether this appellant may file an appeal in this guild, in one place because **two
 * routes have to agree on it exactly**: `checkGuild` renders the form or the reason there isn't one, and
 * `submitAppeal` re-establishes the same answer authoritatively at write time (#232 §4 -- correctness only has
 * to hold at submit, everything before it is a hint). Two copies of this ladder would drift, and the way they
 * would drift is a form that submits into a refusal, or worse, one that doesn't refuse.
 *
 * The order of the checks is load-bearing:
 *
 * 1. **No `appeals_settings` row** -- the guild does not use Appeals. Answered before anything else so a guild
 *    we do not serve costs no Discord call at all, which is what makes the invite entry point cheap.
 * 2. **An appeal that still looks open to them** -- their own data, one indexed read, and the check that keeps a
 *    silent denial silent. Ahead of the probe so the common "checking on my appeal" page load spends nothing.
 * 3. **The ban probe** -- the one Discord call, and the authority. Everything below it is only meaningful for
 *    somebody actually banned, so running it here is also what stops a passer-by learning anything about a
 *    guild's unappealable list.
 * 4. **Unappealable, ceiling, cooldown** -- cheap reads, in increasing order of how much they reveal.
 *
 * Everything from step 2 down is scoped to **the punishment they are under now**, not to their whole history in
 * the guild -- see `appealsForCurrentPunishment`. An account that appealed, was approved, and was banned again
 * is on its first appeal against the new ban, and both the ceiling and the cooldown have to agree with the copy
 * the appellant is shown, which says "the same ban".
 */
export async function evaluateAppealEligibility(
	guildId: Snowflake,
	userId: Snowflake,
	kind: AppealKind,
	logger: Logger,
): Promise<AppealEligibility> {
	const db = getContext().db;

	const [settings] = await db<AppealsSettings[]>`SELECT * FROM appeals_settings WHERE guild_id = ${guildId}`;
	if (!settings) {
		return {
			settings: null,
			questions: [],
			latestAppeal: null,
			probe: null,
			appealsUsed: 0,
			cooldownUntil: null,
			blocked: 'NOT_CONFIGURED',
		};
	}

	const [questions, appeals] = await Promise.all([
		db<AppealQuestions[]>`
			SELECT * FROM appeal_questions WHERE guild_id = ${guildId} ORDER BY position ASC, id ASC
		`,
		// The whole history for this (guild, user, kind), newest first -- it is capped by `max_appeals` at ten
		// and by the cooldown in practice, so this is a handful of rows served by `appeals_user_id_id_idx`.
		db<Appeals[]>`
			SELECT * FROM appeals
			WHERE guild_id = ${guildId} AND user_id = ${userId} AND kind = ${kind}
			ORDER BY id DESC
		`,
	]);

	// Only the appeals about the ban they are under now. Everything older belongs to a punishment that was
	// already lifted, and counting it is what made a re-banned account arrive to find its attempts spent and a
	// cooldown running against a ban that no longer exists.
	const currentAppeals = appealsForCurrentPunishment(appeals);
	const currentAppeal = currentAppeals[0] ?? null;
	const appealsUsed = currentAppeals.length;

	// The appeal that ended their *previous* ban, if there is one. Shown only where we know they are not banned
	// now -- for somebody checking back after an approval it is the entire story, and captioning a fresh ban
	// with it is the bug this scoping exists to fix.
	const endedLastBan = appeals[currentAppeals.length] ?? null;

	const base = { settings, questions, appealsUsed };

	if (currentAppeal && appearsOpenToAppellant(currentAppeal)) {
		return { ...base, latestAppeal: currentAppeal, probe: null, cooldownUntil: null, blocked: 'ALREADY_OPEN' };
	}

	const probe = await probeGuildBan(guildId, userId, logger);
	if (!probe) {
		// Whether this is a new ban is exactly what the probe would have told us, so this falls back to showing
		// the most recent appeal either way. No form renders behind this block, so nothing acts on it.
		return {
			...base,
			latestAppeal: currentAppeal ?? endedLastBan,
			probe: null,
			cooldownUntil: null,
			blocked: 'PROBE_UNAVAILABLE',
		};
	}

	if (!probe.banned) {
		return { ...base, latestAppeal: currentAppeal ?? endedLastBan, probe, cooldownUntil: null, blocked: 'NOT_BANNED' };
	}

	// Past here they are banned, so `currentAppeal` is the only appeal that can be about it.
	const latestAppeal = currentAppeal;

	const [unappealable] = await db<Pick<UnappealableUsers, 'userId'>[]>`
		SELECT user_id FROM unappealable_users WHERE guild_id = ${guildId} AND user_id = ${userId}
	`;
	if (unappealable) {
		return { ...base, latestAppeal, probe, cooldownUntil: null, blocked: 'UNAPPEALABLE' };
	}

	// Ahead of the cooldown deliberately, for the case where both apply: somebody at their ceiling is done, and
	// telling them to come back in 27 days would be a straightforwardly false promise -- they would still be at
	// their ceiling when they did.
	if (settings.maxAppeals !== null && appealsUsed >= settings.maxAppeals) {
		return { ...base, latestAppeal, probe, cooldownUntil: null, blocked: 'MAX_APPEALS' };
	}

	// Measured from the most recent *decision*, not the most recent submission: an appeal a guild sat on for a
	// month has not used up the appellant's cooldown, and one withdrawn the same day has. `WITHDRAWN` carries a
	// `decided_at` too (it is the appellant's own terminal action), so it starts a cooldown like any other --
	// which is deliberate, since otherwise withdraw-and-resubmit would be a way around it entirely.
	const decidedAt = latestAppeal?.decidedAt ?? null;
	if (decidedAt && settings.cooldownDays > 0) {
		const cooldownUntil = new Date(decidedAt.getTime() + settings.cooldownDays * 24 * 60 * 60 * 1_000);
		if (cooldownUntil.getTime() > Date.now()) {
			return { ...base, latestAppeal, probe, cooldownUntil, blocked: 'COOLDOWN' };
		}
	}

	return { ...base, latestAppeal, probe, cooldownUntil: null, blocked: null };
}
