import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { PendingTickets } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';
import { PENDING_TICKET_TTL_MS, PendingTicketByUserStore, PendingTicketStore } from './pendingTicket.js';

/**
 * Run on an interval from `index.ts`'s `bin()`. A ticket's pending window is tracked in Redis with a
 * TTL purely for routing incoming events — that TTL lapsing doesn't tell anyone to act on it, so a
 * private thread whose setup the user never finished (no first message, or all its categories got
 * deleted before they picked one) would otherwise sit around forever. That's a real gap #156's closing
 * flow doesn't cover either: its close command only exists inside a ticket's mod-forum thread, which
 * never gets created for a ticket that never finished being set up. This polls the durable
 * `pending_tickets` table (see schema.sql) for rows past the timeout and deletes the orphaned private
 * thread for each one.
 */
export async function sweepAbandonedPendingTickets(logger: Logger): Promise<void> {
	const cutoff = new Date(Date.now() - PENDING_TICKET_TTL_MS);
	const abandoned = await getContext().db<PendingTickets[]>`
		SELECT * FROM pending_tickets WHERE created_at < ${cutoff}
	`;

	for (const pending of abandoned) {
		try {
			await getContext().service.client.api.channels.delete(pending.privateThreadId, {
				reason: 'Ticket setup abandoned (no first message or category pick within the timeout)',
			});
		} catch (error) {
			// A 404 just means the thread is already gone (deleted manually, archived and pruned, etc.) —
			// not worth logging as a failure, the row still gets cleared below either way.
			if (!(error instanceof DiscordAPIError && error.status === 404)) {
				logger.warn(
					{ err: error, privateThreadId: pending.privateThreadId },
					'Failed to delete an abandoned pending ticket thread',
				);
			}
		}

		await getContext().db`DELETE FROM pending_tickets WHERE private_thread_id = ${pending.privateThreadId}`;

		// Best-effort — these should already have expired via their own TTL around the same time as this
		// row's cutoff, but clearing them explicitly avoids depending on exact clock alignment between
		// Postgres and Redis.
		await Promise.all([
			PendingTicketStore.delete(pending.privateThreadId),
			PendingTicketByUserStore.delete(`${pending.guildId}:${pending.userId}`),
		]);

		logger.info(
			{ guildId: pending.guildId, privateThreadId: pending.privateThreadId, userId: pending.userId },
			'Cleaned up an abandoned pending ticket',
		);
	}
}
