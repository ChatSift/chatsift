import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorCaseAction, AutomoderatorCases, AutomoderatorWarnPunishments } from '@chatsift/db';
import { countActiveWarns } from './cases.js';
import type { CaseActor } from './cases.js';
import { traceDecision } from './decisionTrace.js';
import type { ModerationRequest } from './moderation.js';

export interface WarnLadderRung {
	readonly punishment: AutomoderatorWarnPunishments;
	/**
	 * The warn count that tripped it -- the same number the rung is keyed on, kept so the reason text and the
	 * decision trace don't have to reach back into the row.
	 */
	readonly warns: number;
}

/**
 * Which rung, if any, a member's current warn count trips.
 *
 * **Exact match, not at-least**, which is legacy's rule and the one the editor shows: a guild with rungs at 3
 * and 5 does nothing on the fourth warn. At-least would re-fire the 3-warn punishment on every subsequent warn
 * forever, which is why legacy never did it either.
 *
 * Returns null -- and traces why -- for every guild that has configured no ladder, which is most of them. That
 * trace is the point: "the ladder didn't fire" and "the ladder isn't configured" are the two things a decision
 * log has to be able to tell apart.
 */
export async function resolveWarnLadderRung(
	warnCase: AutomoderatorCases,
	logger: Logger,
): Promise<WarnLadderRung | null> {
	const warns = await countActiveWarns(warnCase.guildId, warnCase.targetId);

	const [punishment] = await getContext().db<AutomoderatorWarnPunishments[]>`
		SELECT * FROM automoderator_warn_punishments
		WHERE guild_id = ${warnCase.guildId} AND warns = ${warns}
	`;

	traceDecision(logger, {
		runner: 'ladder',
		action: punishment?.actionType ?? null,
		guildId: warnCase.guildId,
		targetId: warnCase.targetId,
		ladderCount: warns,
		...(punishment ? { matched: `${warns} warns` } : {}),
	});

	return punishment ? { punishment, warns } : null;
}

/**
 * The moderation the rung calls for.
 *
 * Pure, so the arithmetic that decides how long somebody is muted is testable without a Discord client or a
 * database.
 *
 * A MUTE rung's duration is taken as stored, with no ceiling check: `MAX_TIMEOUT_SECONDS` is enforced where a
 * row is written -- by `services/api` for anything a human configures, and by P9's migration for anything
 * legacy hands over (legacy's column was unbounded milliseconds). Re-checking it here would be a second place
 * for the rule to live, and the one that can only paper over a bad row rather than fix it.
 */
export function buildLadderRequest(
	{ punishment, warns }: WarnLadderRung,
	warnCase: AutomoderatorCases,
	mod: CaseActor | null,
): ModerationRequest {
	const durationMs = punishment.durationSeconds === null ? undefined : punishment.durationSeconds * 1_000;

	return {
		action: punishment.actionType as unknown as AutomoderatorCaseAction,
		guildId: warnCase.guildId,
		target: { id: warnCase.targetId, tag: warnCase.targetTag },
		mod,
		reason: `Automatic punishment for reaching ${warns} ${warns === 1 ? 'warning' : 'warnings'}`,
		refId: warnCase.caseId,
		source: 'ladder',
		skipLadder: true,
		...(durationMs === undefined ? {} : { durationMs }),
	};
}
