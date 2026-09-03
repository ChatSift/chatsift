import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type {
	AutomoderatorCaseAction,
	AutomoderatorTriggerCounts,
	AutomoderatorTriggerPunishments,
} from '@chatsift/db';
import { formatCaseRef } from './caseLog.js';
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
 * How long one message stays claimed against a second count.
 *
 * The window in which the *same* message can trip the filters again, which is an edit -- `filterRunner.ts` runs
 * on `MESSAGE_UPDATE` deliberately, to catch a link edited in after posting. Normally the message is deleted on
 * the first hit and no edit can follow, but a message the bot could not delete (or was not allowed to, in
 * dry-run) survives, and every later edit that still trips a filter would otherwise be a fresh rung. A member
 * fixing three typos on a message that still carries a forbidden link should not climb three.
 *
 * A day rather than something shorter: an edit hours later is still an edit of the same offence. Longer than
 * that and it stops being one -- somebody dredging up a day-old message to edit a link into it is doing a new
 * thing, and should be counted for it.
 */
export const TRIGGER_CLAIM_TTL_MS = 24 * 60 * 60 * 1_000;

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
	 * The case the rung produced, when it produced one, already rendered as `#12` (hyperlinked to its own
	 * mod-log message where there is one, #381). Goes into the filter log so staff read the deletion and the
	 * punishment it escalated into as one event rather than two unconnected ones.
	 */
	readonly caseRef?: string;
	/**
	 * The member's trigger count **after** this hit, whether or not a rung matched -- "no rung fired and they
	 * are on 4" is an answer the filter log should be able to give.
	 */
	readonly count: number;
	/**
	 * What the rung did, in the guild's words, or null when no rung matched this count.
	 */
	readonly summary: string | null;
}

/**
 * True the first time a message is counted, false every time after.
 *
 * `SET NX PX` -- one round trip, atomic, the same claim `claimAutomodExecution` makes on the native path and
 * for the same shape of reason. What it stops is an *edit* being counted as a second offence: the filters
 * deliberately re-run on `MESSAGE_UPDATE`, so a message that survived its first hit -- one the bot could not
 * delete, or was not allowed to in dry-run -- would otherwise cost a rung per typo fix.
 *
 * **Fails open**, matching `claimAutomodExecution` and its reasoning exactly: a redis outage lets a count
 * through twice, where failing closed would stop the ladder entirely for as long as redis is down. Between
 * "moderation happens twice" and "moderation stops", the first is the recoverable one.
 */
async function claimMessage(guildId: string, messageId: string, logger: Logger): Promise<boolean> {
	try {
		const claimed = await getContext().redis.set(`automoderator:trigger-count:${guildId}:${messageId}`, '1', {
			NX: true,
			PX: TRIGGER_CLAIM_TTL_MS,
		});

		return claimed !== null;
	} catch (error) {
		logger.warn({ err: error, guildId, messageId }, 'could not claim a filter trigger -- it may be counted twice');
		return true;
	}
}

/**
 * Records one filter trigger against a member and carries out the rung it lands on, if any. Null means nothing
 * was counted at all -- either the guild has no ladder, or this message has already been counted.
 *
 * **Once per message, not once per filter, and once per message _ever_.** A message carrying both a forbidden
 * link and a forbidden invite is one thing the member did, and so is the same message edited twice afterwards.
 * The first is structural (one call per message); the second is `claimMessage`.
 *
 * **Nothing is written for a guild with no ladder configured.** The `EXISTS` in the insert is what keeps
 * `automoderator_trigger_counts` from being a table that only grows: a guild running the filters with no rungs
 * and no decay would otherwise accumulate a permanent row per offending member forever, to feed a ladder that
 * does not exist. Configuring a ladder later starts everyone from zero, which is the only honest answer -- hits
 * that were never recorded cannot be counted retroactively.
 *
 * The count is still incremented in dry-run, which has to be able to demonstrate the ladder or it is not a
 * preview of anything. It is *not* incremented when the delete failed; that gate is `filterRunner.ts`'s, next
 * to the DM it already suppresses for the same reason.
 */
export async function applyTriggerLadder(
	{ guildId, messageId, target }: { guildId: string; messageId: string; target: CaseActor },
	logger: Logger,
): Promise<TriggerLadderResult | null> {
	const db = getContext().db;

	if (!(await claimMessage(guildId, messageId, logger))) {
		traceDecision(logger, { runner: 'trigger_ladder', guildId, targetId: target.id, action: null });
		return null;
	}

	// Atomic, so two replicas handling two messages of the same burst cannot both read 3 and both write 4. The
	// `EXISTS` is the growth guard described above; no row back means the guild has no ladder at all.
	const [row] = await db<Pick<AutomoderatorTriggerCounts, 'count'>[]>`
		INSERT INTO automoderator_trigger_counts (guild_id, user_id, count)
		SELECT ${guildId}, ${target.id}, 1
		WHERE EXISTS (SELECT 1 FROM automoderator_trigger_punishments WHERE guild_id = ${guildId})
		ON CONFLICT (guild_id, user_id) DO UPDATE
			SET count = automoderator_trigger_counts.count + 1, updated_at = now()
		RETURNING count
	`;

	if (!row) {
		return null;
	}

	const count = row.count;

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
		caseRef: await formatCaseRef(result.case),
	};
}
