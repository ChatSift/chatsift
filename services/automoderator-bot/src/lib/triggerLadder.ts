import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type {
	AutomoderatorCaseAction,
	AutomoderatorTriggerCounts,
	AutomoderatorTriggerPunishments,
} from '@chatsift/db';
import type { CaseActor } from './cases.js';
import { traceDecision } from './decisionTrace.js';
import { applyModerationAction } from './moderation.js';

/**
 * The trigger ladder (P5c, feature 11): what happens once a member has tripped the runner filters enough times.
 *
 * This is what gives P5b's runners teeth. A URL or invite hit deletes the message and DMs the member and files
 * nothing -- deliberately, because posting a link is something somebody can do by accident once. Doing it six
 * times is not an accident, and this is the half that says so.
 *
 * **Banword hits are not counted**, and cannot be from here: this runs inside the filter pipeline, and native
 * AutoMod hits arrive on a different path entirely (`automodIntake.ts`). A banword policy carries its own
 * punishment, so counting it here would stack a ladder action on top of a ban for one message.
 */

/**
 * Mirrors `CREATE TYPE automoderator_trigger_punishment_action`. A hand-written union for the same reason
 * `automodIntake.ts`'s `BanwordActionName` is one: kanel emits the enum as a real TypeScript enum and
 * `@chatsift/db` re-exports only its type, so there is no runtime value to reference.
 */
type TriggerActionName = 'BAN' | 'KICK' | 'MUTE' | 'WARN';

const TRIGGER_CASE_ACTION = {
	WARN: 'WARN',
	MUTE: 'MUTE',
	KICK: 'KICK',
	BAN: 'BAN',
} as unknown as Record<TriggerActionName, AutomoderatorCaseAction>;

const SUMMARY_PAST: Record<TriggerActionName, string> = {
	WARN: 'Warned',
	MUTE: 'Muted',
	KICK: 'Kicked',
	BAN: 'Banned',
};

const SUMMARY_CONDITIONAL: Record<TriggerActionName, string> = {
	WARN: 'Would have warned',
	MUTE: 'Would have muted',
	KICK: 'Would have kicked',
	BAN: 'Would have banned',
};

export interface TriggerLadderResult {
	/**
	 * The case the rung produced, when it produced one. Rendered into the filter log so staff read the deletion
	 * and the punishment it escalated into as one event rather than two unconnected ones.
	 */
	readonly caseId?: number;
	/**
	 * The member's trigger count **after** this hit, whether or not a rung matched. Always present, because "no
	 * rung fired and they are on 4" is the answer the filter log should give.
	 */
	readonly count: number;
	/**
	 * What the rung did, in the guild's words, or null when no rung matched this count.
	 */
	readonly summary: string | null;
}

/**
 * Records one filter trigger against a member and carries out the rung it lands on, if any.
 *
 * **Once per message, not once per filter.** A message carrying both a forbidden link and a forbidden invite is
 * one thing the member did; counting it twice would push them up the ladder at double speed for a single post.
 *
 * The count is incremented even in dry-run and even when the delete failed. Dry-run has to be able to
 * demonstrate the ladder or it is not a preview of anything, and a delete Discord refused does not un-happen the
 * trigger -- the member posted the thing.
 */
export async function applyTriggerLadder(
	{ guildId, target }: { guildId: string; target: CaseActor },
	logger: Logger,
): Promise<TriggerLadderResult> {
	const db = getContext().db;

	// Atomic, so two replicas handling two messages of the same burst cannot both read 3 and both write 4.
	const [row] = await db<Pick<AutomoderatorTriggerCounts, 'count'>[]>`
		INSERT INTO automoderator_trigger_counts (guild_id, user_id, count)
		VALUES (${guildId}, ${target.id}, 1)
		ON CONFLICT (guild_id, user_id) DO UPDATE
			SET count = automoderator_trigger_counts.count + 1, updated_at = now()
		RETURNING count
	`;

	const count = row!.count;

	const [punishment] = await db<AutomoderatorTriggerPunishments[]>`
		SELECT * FROM automoderator_trigger_punishments WHERE guild_id = ${guildId} AND triggers = ${count}
	`;

	const traceBase = { runner: 'trigger_ladder', guildId, targetId: target.id, ladderCount: count };

	if (!punishment) {
		// Traced even though nothing happened, which is the case worth tracing: "they are on 4 and your ladder
		// starts at 5" is the answer to "why wasn't anything done", and it is invisible otherwise.
		traceDecision(logger, { ...traceBase, action: null });
		return { count, summary: null };
	}

	const action = punishment.actionType as unknown as TriggerActionName;

	// The same runtime guard, for the same reason, as `classifyPolicyAction`: a row this build does not
	// understand is a migration that added an action ahead of the code, and indexing the map to `undefined`
	// would hand `applyModerationAction` a case action nobody configured.
	if (!(action in TRIGGER_CASE_ACTION)) {
		logger.error(
			{ guildId, targetId: target.id, actionType: punishment.actionType },
			'trigger ladder step names an action this build does not know how to carry out',
		);
		return { count, summary: 'Nothing done: this ladder step names an unrecognised action' };
	}

	const durationMs = punishment.durationSeconds === null ? undefined : punishment.durationSeconds * 1_000;

	const result = await applyModerationAction(
		{
			action: TRIGGER_CASE_ACTION[action],
			guildId,
			target,
			// No human authored this, the same as a banword policy's punishment. A case attributed to whoever
			// configured the ladder would claim they were online and acting.
			mod: null,
			reason: `Automatic punishment for tripping the filters ${count} ${count === 1 ? 'time' : 'times'}`,
			source: 'ladder',
			...(durationMs === undefined ? {} : { durationMs }),
		},
		logger,
	);

	traceDecision(logger, {
		...traceBase,
		action,
		dryRun: result.suppressed,
		matched: `${count} triggers`,
	});

	return {
		count,
		summary: result.suppressed ? SUMMARY_CONDITIONAL[action] : SUMMARY_PAST[action],
		caseId: result.case.caseId,
	};
}
