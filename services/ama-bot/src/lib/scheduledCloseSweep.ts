import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';

/**
 * Run on an interval from `index.ts`'s `bin()` -- `ama_sessions.scheduled_close_at` lapsing doesn't end
 * anything on its own, this is what actually acts on it. Flips `ended` the same plain way
 * `components/amaEndSelect.ts` does (no Discord message posted); the `ended = false` filter mirrors
 * modmail's `scheduledCloseSweep.ts` guarding against re-processing a session someone already ended
 * manually (via `/ama end`) before this got to it.
 */
export async function sweepScheduledAmaCloses(logger: Logger): Promise<void> {
	const due = await getContext().db<{ id: number; title: string }[]>`
		UPDATE ama_sessions
		SET ended = true
		WHERE scheduled_close_at <= now() AND ended = false
		RETURNING id, title
	`;

	for (const session of due) {
		logger.info({ amaId: session.id }, `Auto-ended AMA "${session.title}" via its scheduled close date`);
	}
}
