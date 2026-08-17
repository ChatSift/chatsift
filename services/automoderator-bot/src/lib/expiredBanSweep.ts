import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorCases } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { CASE_ACTION } from './caseActions.js';
import { updateCase } from './cases.js';
import { schedulerLag, schedulerTasks } from './metrics.js';
import { applyModerationAction } from './moderation.js';

/**
 * How many expiries one tick will lift. A ceiling rather than a target: it bounds the Discord calls a single
 * replica makes in one burst, and anything it doesn't reach is still due on the next tick.
 */
const BATCH_SIZE = 25;

export const EXPIRED_BAN_SWEEP_INTERVAL_MS = 15_000;

/**
 * Claims due tempbans by writing `lifted_at`, and hands back the rows claimed.
 *
 * **The write is the claim, not a record of success** -- exactly the shape P3's report action uses, and for the
 * same reason: the unban that follows is the irreversible half, so it must not be reachable by two replicas.
 * `FOR UPDATE SKIP LOCKED` inside the subquery is what makes concurrent sweeps take disjoint slices instead of
 * queueing behind each other's row locks, and the lock is released the instant the statement commits -- nothing
 * is held across a Discord call.
 *
 * This is also why the sweep wants no `ownsShardForGuild` filter, unlike ModMail's: it *claims* rather than
 * reads, so filtering by shard would only leave a guild's expired bans sitting there whenever the replica that
 * owns it lost the race.
 */
async function claimExpiredBans(limit: number): Promise<AutomoderatorCases[]> {
	return getContext().db<AutomoderatorCases[]>`
		UPDATE automoderator_cases SET lifted_at = now()
		WHERE id IN (
			SELECT id FROM automoderator_cases
			WHERE action_type = 'BAN' AND expires_at IS NOT NULL AND expires_at <= now() AND lifted_at IS NULL
			ORDER BY expires_at ASC
			LIMIT ${limit}
			FOR UPDATE SKIP LOCKED
		)
		RETURNING *
	`;
}

/**
 * Lifts every tempban whose expiry has passed.
 *
 * A failure puts the claim back rather than counting attempts and eventually giving up, which is what legacy
 * did (three tries, then delete the task). Giving up on an unban produces a permanent ban that claims to be
 * temporary -- the exact thing this feature exists to prevent -- so a stuck expiry is retried every tick until
 * it succeeds or somebody deletes the case. `automoderator_scheduler_lag_seconds` climbing is the signal that
 * one is stuck, and the error log says why.
 */
export async function sweepExpiredBans(logger: Logger): Promise<void> {
	const due = await claimExpiredBans(BATCH_SIZE);

	await Promise.all(
		due.map(async (banCase) => {
			schedulerLag.observe({ type: 'expiry' }, (Date.now() - banCase.expiresAt!.getTime()) / 1_000);

			const caseLogger = logger.child({ guildId: banCase.guildId, caseId: banCase.caseId });

			try {
				await applyModerationAction(
					{
						action: CASE_ACTION.UNBAN,
						guildId: banCase.guildId,
						target: { id: banCase.targetId, tag: banCase.targetTag },
						// Nobody authored this. Attributing it to whoever issued the ban would claim they came back
						// and lifted it, which is the sort of thing a two-year-old case gets read for.
						mod: null,
						reason: `Temporary ban from case #${banCase.caseId} expired`,
						refId: banCase.caseId,
						source: 'scheduler',
						// They aren't in the guild -- a DM would need a shared server we no longer have.
						notifyTarget: false,
					},
					caseLogger,
				);

				schedulerTasks.inc({ type: 'expiry', result: 'ok' });
			} catch (error) {
				// Already unbanned by someone we didn't observe. The claim stands: there is nothing left to lift,
				// and rolling it back would retry this forever.
				if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownBan) {
					caseLogger.info('temporary ban had already been lifted elsewhere');
					schedulerTasks.inc({ type: 'expiry', result: 'ok' });
					return;
				}

				await updateCase(banCase.id, { liftedAt: null });
				schedulerTasks.inc({ type: 'expiry', result: 'failed' });
				caseLogger.error({ err: error }, 'failed to lift an expired temporary ban; will retry');
			}
		}),
	);
}
