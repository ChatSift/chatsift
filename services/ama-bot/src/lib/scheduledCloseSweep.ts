import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { sessionTransitions } from './metrics.js';

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
		// A guild that sets scheduled closes and never sees `closed{source="scheduled"}` has a stopped sweep,
		// and the symptom -- an AMA that never ends -- gives no hint that a bot loop is where to look.
		sessionTransitions.inc({ transition: 'closed', source: 'scheduled' });
		logger.info(
			{ amaId: session.id },
			`Auto-closed question submissions for AMA "${session.title}" via its scheduled close date`,
		);
	}
}
