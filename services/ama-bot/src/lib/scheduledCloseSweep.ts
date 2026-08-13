import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';

/**
 * Reopening a session whose date has already lapsed clears `scheduled_close_at` (see `updateAMA.ts`), so
 * this can't immediately re-close what someone just deliberately reopened.
 */
export async function sweepScheduledAmaCloses(logger: Logger): Promise<void> {
	// Unlike other sweeps in this codebase, this is just a single UPDATE query. It's fully atomic,
	// no need for the usual stuff.
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
