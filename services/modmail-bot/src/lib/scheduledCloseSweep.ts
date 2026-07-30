import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';
import { getOwnershipScope } from './instance.js';
import { closeThread } from './threadClose.js';

interface DueScheduledClose extends Threads {
	anon: boolean;
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
	// See docs/roadmap/01-architecture.md §8 -- closing a ticket in a guild this deployment
	// doesn't own would race whichever deployment does.
	const scope = getOwnershipScope();

	const due = await getContext().db<DueScheduledClose[]>`
		SELECT t.*, sc.scheduled_by_id, sc.silent, sc.anon
		FROM scheduled_thread_closes sc
		INNER JOIN threads t ON t.id = sc.thread_id
		WHERE sc.close_at <= now() AND t.closed_at IS NULL
			AND ${scope.kind === 'only' ? getContext().db`t.guild_id = ${scope.guildId}` : getContext().db`t.guild_id != ALL(${scope.excludedGuildIds})`}
	`;

	await Promise.all(
		due.map(async (row) => {
			const rowLogger = logger.child({ guildId: row.guildId, threadId: row.id });

			try {
				await closeThread({
					anon: row.anon,
					closedById: row.scheduledById,
					logger: rowLogger,
					silent: row.silent,
					thread: row,
				});
			} catch (error) {
				rowLogger.error({ err: error }, 'Failed to run a scheduled ticket close');
			}
		}),
	);
}
