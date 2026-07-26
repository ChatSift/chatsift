import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';
import { closeThread } from './threadClose.js';

interface DueScheduledClose extends Threads {
	scheduledById: string;
	silent: boolean;
}

/**
 * Run on an interval from `index.ts`'s `bin()` — `scheduled_thread_closes.close_at` lapsing doesn't
 * close anything on its own, this is what actually acts on it. `closeThread` itself is what's race-safe
 * against a manual `/close` beating this to the same ticket (see its `closed_at IS NULL` guard); the
 * `t.closed_at IS NULL` filter here is just to avoid even attempting rows that are obviously already
 * done.
 */
export async function sweepScheduledCloses(logger: Logger): Promise<void> {
	const due = await getContext().db<DueScheduledClose[]>`
		SELECT t.*, sc.scheduled_by_id, sc.silent
		FROM scheduled_thread_closes sc
		INNER JOIN threads t ON t.id = sc.thread_id
		WHERE sc.close_at <= now() AND t.closed_at IS NULL
	`;

	await Promise.all(
		due.map(async (row) => {
			try {
				await closeThread({ closedById: row.scheduledById, logger, silent: row.silent, thread: row });
			} catch (error) {
				logger.error({ err: error, threadId: row.id }, 'Failed to run a scheduled ticket close');
			}
		}),
	);
}
