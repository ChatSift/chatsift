import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { PendingTickets } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';
import { withGuildUserLock } from './guildUserQueue.js';
import { PENDING_TICKET_TTL_MS, PendingTicketStore } from './pendingTicket.js';

/**
 * Run on an interval from `index.ts`'s `bin()`. A ticket's pending window is tracked in Redis with a
 * TTL purely for routing incoming events — that TTL lapsing doesn't tell anyone to act on it, so a
 * private thread whose setup the user never finished would otherwise sit around forever. By the time a
 * private thread (and so a `pending_tickets` row) exists at all, the category question is already
 * settled — either resolved to a real category (`categorySelect.ts`) or the panel had none configured to
 * begin with (`createTicket.ts`) — so the only thing left to abandon is the user never sending their
 * opening message. That's a real gap #156's closing flow doesn't cover either: its close command only
 * exists inside a ticket's mod-forum thread, which never gets created for a ticket that never finished
 * being set up. This polls the durable `pending_tickets` table (see schema.sql) for rows past the
 * timeout and deletes the orphaned private thread for each one.
 */
export async function sweepAbandonedPendingTickets(logger: Logger): Promise<void> {
	// A `pending_tickets` row is supposed to be cleared the moment its ticket resolves (see
	// `handleFirstMessage` in index.ts) — but that clear is best-effort against process crashes, so a
	// completed ticket's row could in principle still be sitting here past the cutoff. The LEFT JOIN
	// excludes exactly that case: never delete a private thread that a real `threads` row (an active,
	// in-progress conversation) already points at.
	const [abandoned, stale] = await Promise.all([
		getContext().db<PendingTickets[]>`
			SELECT pt.* FROM pending_tickets pt
			LEFT JOIN threads t ON t.user_thread_id = pt.private_thread_id
			WHERE pt.created_at < ${new Date(Date.now() - PENDING_TICKET_TTL_MS)} AND t.id IS NULL
		`,
		// Rows left behind by the same crash scenario, but for a ticket that *did* finish — nothing to
		// abandon here, just stale bookkeeping to drop so the table stays small regardless of age.
		getContext().db<PendingTickets[]>`
			SELECT pt.* FROM pending_tickets pt
			INNER JOIN threads t ON t.user_thread_id = pt.private_thread_id
		`,
	]);

	for (const row of stale) {
		await getContext().db`DELETE FROM pending_tickets WHERE private_thread_id = ${row.privateThreadId}`;

		// The ticket already finished, so nothing here should still be live — but clear the same Redis
		// state the abandoned path below does, in case whatever crashed also skipped that step.
		await PendingTicketStore.delete(row.privateThreadId);
	}

	for (const pending of abandoned) {
		// Re-checked under the same per guild+user lock `finishTicketCreation` holds while turning a
		// pending ticket into a real one (see categorySelect.ts/index.ts) — the initial scan above could
		// be arbitrarily stale by the time execution reaches here, and without this a ticket that
		// finishes in that gap would have its brand-new private thread deleted out from under it. Either
		// the finish already ran and cleared this row (the re-check below finds nothing to do), or it's
		// still queued behind this very lock and can't race us.
		await withGuildUserLock(pending.guildId, pending.userId, async () => {
			const [stillAbandoned] = await getContext().db<PendingTickets[]>`
				SELECT pt.* FROM pending_tickets pt
				LEFT JOIN threads t ON t.user_thread_id = pt.private_thread_id
				WHERE pt.private_thread_id = ${pending.privateThreadId} AND t.id IS NULL
			`;

			if (!stillAbandoned) {
				return;
			}

			try {
				await getContext().service.client.api.channels.delete(pending.privateThreadId, {
					reason: 'Ticket setup abandoned (no opening message sent within the timeout)',
				});
			} catch (error) {
				// A 404 just means the thread is already gone (deleted manually, archived and pruned, etc.) —
				// not worth logging as a failure, the row still gets cleared below either way.
				if (!(error instanceof DiscordAPIError && error.status === 404)) {
					logger.warn(
						{ err: error, guildId: pending.guildId, privateThreadId: pending.privateThreadId },
						'Failed to delete an abandoned pending ticket thread',
					);
				}
			}

			await getContext().db`DELETE FROM pending_tickets WHERE private_thread_id = ${pending.privateThreadId}`;

			// Best-effort — this should already have expired via its own TTL around the same time as this
			// row's cutoff, but clearing it explicitly avoids depending on exact clock alignment between
			// Postgres and Redis.
			await PendingTicketStore.delete(pending.privateThreadId);

			logger.info(
				{ guildId: pending.guildId, privateThreadId: pending.privateThreadId, userId: pending.userId },
				'Cleaned up an abandoned pending ticket',
			);
		});
	}
}
