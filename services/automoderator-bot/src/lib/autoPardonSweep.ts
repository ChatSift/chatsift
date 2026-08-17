import type { Logger } from '@chatsift/backend-core';
import { getContext, publishRealtimeInvalidate } from '@chatsift/backend-core';
import { getSelfId } from '@chatsift/bot-core';
import { automoderatorCasesChannel } from '@chatsift/core';
import type { AutomoderatorCases } from '@chatsift/db';
import { dispatchCaseLog } from './caseLog.js';
import { schedulerTasks } from './metrics.js';

/**
 * Bounded because each pardoned case rewrites its mod-log embed. A guild turning auto-pardon on for the first
 * time can have years of warns fall due at once; this drains them over successive ticks rather than firing
 * hundreds of webhook edits in one burst.
 */
const BATCH_SIZE = 100;

export const AUTO_PARDON_SWEEP_INTERVAL_MS = 10 * 60 * 1_000;

/**
 * Pardons warns older than their guild's `auto_pardon_warns_after`, so an old warn stops counting toward the
 * ladder.
 *
 * One statement across every guild, rather than legacy's per-guild loop with a cache in front of it -- which
 * had a bug that made it `continue` on every case it ever looked at, so auto-pardon never fired at all.
 *
 * `pardoned_by IS NULL` in the `UPDATE` makes the claim a compare-and-swap, which is what lets two replicas run
 * this without both pardoning (and both re-logging) the same case. Same reason the expiry sweep needs no
 * `ownsShardForGuild` filter.
 */
export async function sweepAutoPardons(logger: Logger): Promise<void> {
	const db = getContext().db;
	const selfId = await getSelfId(getContext().service.client.api);

	const pardoned = await db<AutomoderatorCases[]>`
		WITH due AS (
			SELECT c.id
			FROM automoderator_cases c
			INNER JOIN automoderator_guild_settings s ON s.guild_id = c.guild_id
			WHERE c.action_type = 'WARN'
				AND c.pardoned_by IS NULL
				AND s.auto_pardon_warns_after IS NOT NULL
				AND c.created_at + make_interval(days => s.auto_pardon_warns_after) <= now()
			ORDER BY c.created_at ASC
			LIMIT ${BATCH_SIZE}
		)
		UPDATE automoderator_cases c SET pardoned_by = ${selfId}
		FROM due
		WHERE c.id = due.id AND c.pardoned_by IS NULL
		RETURNING c.*
	`;

	if (pardoned.length === 0) {
		return;
	}

	logger.info({ count: pardoned.length }, 'auto-pardoned expired warns');

	// This is the one path that writes a case without going through `updateCase`, so it is also the one that
	// has to publish for itself -- otherwise an open case browser keeps showing these as un-pardoned until some
	// unrelated edit invalidates it. Once per guild rather than once per case: the channel is guild-wide.
	await Promise.all(
		[...new Set(pardoned.map((pardonedCase) => pardonedCase.guildId))].map(async (guildId) =>
			publishRealtimeInvalidate(automoderatorCasesChannel(guildId)),
		),
	);

	for (const pardonedCase of pardoned) {
		try {
			await dispatchCaseLog(pardonedCase, logger, 'scheduler');
			schedulerTasks.inc({ type: 'auto_pardon', result: 'ok' });
		} catch (error) {
			schedulerTasks.inc({ type: 'auto_pardon', result: 'failed' });
			logger.error(
				{ err: error, guildId: pardonedCase.guildId, caseId: pardonedCase.caseId },
				'failed to rewrite the log for an auto-pardoned warn',
			);
		}
	}
}
