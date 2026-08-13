import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';

/**
 * Run on an interval from `index.ts`'s `bin()` -- `ama_sessions.scheduled_close_at` lapsing doesn't close
 * anything on its own, this is what actually acts on it. Flips `ended` (which only gates new question
 * submissions, see #299) the same plain way `components/amaCloseSelect.ts` does (no Discord message posted);
 * the `ended = false` filter mirrors modmail's `scheduledCloseSweep.ts` guarding against re-processing a
 * session someone already closed manually (via `/ama close`) before this got to it.
 *
 * Reopening a session whose date has already lapsed clears `scheduled_close_at` (see `updateAMA.ts`), so
 * this can't immediately re-close what someone just deliberately reopened.
 */
export async function sweepScheduledAmaCloses(logger: Logger): Promise<void> {
	// Deliberately *not* shard-scoped with `ownsShardForGuild`, unlike ModMail's sweeps. This is a single atomic
	// `UPDATE ... WHERE ended = false ... RETURNING`, so exactly one replica's statement can ever claim a given
	// row and the rest come back empty -- the row is the lock. Adding a guild filter on top would buy nothing and
	// would mean selecting a `guild_id` this query has no other use for.
	const due = await getContext().db<{ id: number; title: string }[]>`
		UPDATE ama_sessions
		SET ended = true
		WHERE scheduled_close_at <= now() AND ended = false
		RETURNING id, title
	`;

	for (const session of due) {
		logger.info(
			{ amaId: session.id },
			`Auto-closed question submissions for AMA "${session.title}" via its scheduled close date`,
		);
	}
}
