import { getContext, RedisStore } from '@chatsift/backend-core';
import type { CategoriesId } from '@chatsift/db';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';

/**
 * How long a ticket is allowed to sit pending (private thread created, waiting on the user's first
 * message or category pick) before it's considered abandoned. Shared between `PendingTicketStore`
 * below (routing state) and `pending_tickets` (the durable record `lib/pendingTicketSweep.ts` polls) —
 * both track the same window and need to agree on its length.
 */
export const PENDING_TICKET_TTL_MS = 30 * 60 * 1_000;

export interface PendingTicketState {
	/**
	 * The category already resolved before this thread was created (`categorySelect.ts`), or `0` for a
	 * panel with no categories configured (`createTicket.ts`'s zero-category path) — `0` is never a real
	 * category id (`categories.id` is an `IDENTITY` column starting at 1), so it's used as the sentinel
	 * here rather than `null`.
	 */
	categoryId: number;
	guildId: string;
	userId: string;
}

/**
 * A private thread exists but isn't a ticket yet — the user is expected to describe their issue
 * before anything is sent to staff. Keyed by the private thread's channel id, this bridges ticket
 * creation (`createTicket.ts` for a zero-category panel, `categorySelect.ts` once a category is
 * picked - either way the category is already resolved by the time a thread exists) to the
 * `MessageCreate` handler in `index.ts` that catches the user's first message and finishes the ticket.
 */
export const PendingTicketStore = new RedisStore<PendingTicketState>({
	TTL: PENDING_TICKET_TTL_MS,
	// bin-rw's own inferred type has every field nullable; none of these three ever actually are here --
	// the cast corrects that.
	recipe: createRecipe(
		{
			categoryId: DataType.I32,
			guildId: DataType.String,
			userId: DataType.String,
		},
		{ versioned: true },
	) as Recipe<PendingTicketState>,
	makeKey: (channelId: string) => `modmail:pending-ticket:${channelId}`,
	storeOld: false,
});

export interface PendingTicketRecord {
	/**
	 * `null` for a zero-category panel's pending ticket, same meaning as `threads.categoryId` — stored
	 * durably (not just in the Redis state above) so `countOpenThreadsForUserInCategory` (lib/threads.ts)
	 * can count a still-pending pick against its category's limit, closing the race a burst of category
	 * picks for the same category would otherwise have against that limit (see the DB comment on
	 * `pending_tickets.category_id`).
	 */
	categoryId: CategoriesId | null;
	guildId: string;
	privateThreadId: string;
	userId: string;
}

/**
 * Durable counterpart to the two Redis stores above — inserted alongside them the moment a ticket
 * enters its pending window. `lib/pendingTicketSweep.ts` is the reason this exists at all: a Redis key
 * TTL lapsing gives nothing to act on, so this row is what a periodic sweep can actually query for
 * ("which pending tickets are older than the timeout") to find and delete abandoned private threads.
 */
export async function recordPendingTicket({
	categoryId,
	guildId,
	privateThreadId,
	userId,
}: PendingTicketRecord): Promise<void> {
	await getContext().db`
		INSERT INTO pending_tickets (private_thread_id, guild_id, user_id, category_id)
		VALUES (${privateThreadId}, ${guildId}, ${userId}, ${categoryId})
	`;
}

/**
 * Called once a pending ticket resolves, success or failure — a completed ticket has a real `threads`
 * row instead, and a failed one shouldn't stay queued for the sweep to "clean up" a thread that's
 * already gone or was never actually abandoned.
 */
export async function clearPendingTicketRecord(privateThreadId: string): Promise<void> {
	await getContext().db`DELETE FROM pending_tickets WHERE private_thread_id = ${privateThreadId}`;
}
