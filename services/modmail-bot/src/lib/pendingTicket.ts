import { getContext, RedisStore } from '@chatsift/backend-core';
import { createRecipe, DataType } from 'bin-rw';

/**
 * How long a ticket is allowed to sit pending (private thread created, waiting on the user's first
 * message or category pick) before it's considered abandoned. Shared between the two Redis stores
 * below (routing state) and `pending_tickets` (the durable record `lib/pendingTicketSweep.ts` polls) —
 * all three track the same window and need to agree on its length.
 */
export const PENDING_TICKET_TTL_MS = 30 * 60 * 1_000;

export interface PendingTicketState {
	categoryIds: number[];
	guildId: string;
	userId: string;
}

/**
 * A private thread exists but isn't a ticket yet — the user is expected to describe their issue
 * before anything is sent to staff. Keyed by the private thread's channel id, this bridges
 * `createTicket.ts` (which only knows the panel's allowed categories at button-click time) to the
 * `MessageCreate` handler in `index.ts` that catches the user's first message and either finishes
 * the ticket outright (no categories configured) or prompts for a category next.
 */
export const PendingTicketStore = new RedisStore<PendingTicketState>({
	TTL: PENDING_TICKET_TTL_MS,
	recipe: createRecipe({
		categoryIds: [DataType.I32],
		guildId: DataType.String,
		userId: DataType.String,
	}),
	makeKey: (channelId: string) => `modmail:pending-ticket:${channelId}`,
	storeOld: false,
});

export interface PendingTicketByUserState {
	privateThreadId: string;
}

/**
 * Secondary index over the same pending-ticket window, keyed by `${guildId}:${userId}` instead of the
 * private thread's channel id. `findOpenThreadForUser` (lib/threads.ts) only catches a ticket once
 * `finishTicketCreation` has actually run — before that (the whole time a ticket sits pending on the
 * user's first message, or on a category pick), nothing stopped a second `modmail-create-ticket`
 * click from spinning up a duplicate private thread. This is checked by `createTicket.ts` alongside
 * `withGuildUserLock` (lib/guildUserQueue.ts): the lock makes truly concurrent clicks safe, this index
 * is what makes a second click *minutes* later (after the first click's handler already returned) get
 * rejected instead of creating a duplicate. Same TTL as `PendingTicketStore` since they track the same
 * window; cleared explicitly once the ticket resolves (success or failure) rather than left to expire.
 */
export const PendingTicketByUserStore = new RedisStore<PendingTicketByUserState>({
	TTL: PENDING_TICKET_TTL_MS,
	recipe: createRecipe({
		privateThreadId: DataType.String,
	}),
	makeKey: (key: string) => `modmail:pending-ticket-by-user:${key}`,
	storeOld: false,
});

export interface PendingTicketRecord {
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
export async function recordPendingTicket({ guildId, privateThreadId, userId }: PendingTicketRecord): Promise<void> {
	await getContext().db`
		INSERT INTO pending_tickets (private_thread_id, guild_id, user_id)
		VALUES (${privateThreadId}, ${guildId}, ${userId})
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
