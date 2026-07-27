import { getContext } from '@chatsift/backend-core';
import type { Threads, ThreadMessages } from '@chatsift/db';

/**
 * The longest `auto_archive_duration` Discord offers (7 days, in minutes). Used for both a ticket's
 * private thread and its mod-forum thread so an idle-but-open conversation takes as long as possible
 * to get caught by Discord's own archive timer in the first place — `preventThreadArchive.ts`'s sweep
 * is the backstop for whatever this doesn't already prevent. No longer boost-gated: Discord dropped
 * the server-boost requirement for this tier in 2022, so it's available to every guild.
 */
export const MAX_THREAD_AUTO_ARCHIVE_DURATION_MINUTES = 10_080;

/**
 * A user's total concurrent tickets in a guild, counting both real open `threads` rows and tickets
 * still mid-setup (`pending_tickets` — private thread created, no `threads` row yet since the mod-forum
 * side hasn't been resolved, which only happens once the user's opening message arrives). Both count
 * against `guild_settings.max_concurrent_threads` because a pending ticket already holds a private
 * thread and will become a real one imminently — not counting it would let a burst of clicks (all
 * still pending) blow past the limit before any of them finish. Checked as a fast pre-check by
 * `createTicket.ts` and, authoritatively, by `categorySelect.ts` immediately before it actually creates
 * a private thread — both under the same per guild+user lock (`lib/guildUserQueue.ts`) every other
 * ticket-lifecycle step uses, so the categorized path's count can't go stale between its check and the
 * create.
 */
export async function countActiveTicketsForUser(guildId: string, userId: string): Promise<number> {
	const [row] = await getContext().db<[{ count: string }]>`
		SELECT (
			(SELECT COUNT(*) FROM threads WHERE guild_id = ${guildId} AND user_id = ${userId} AND closed_at IS NULL) +
			(SELECT COUNT(*) FROM pending_tickets WHERE guild_id = ${guildId} AND user_id = ${userId})
		) AS count
	`;

	return Number(row?.count ?? 0);
}

/**
 * A user's open tickets within one specific category, checked against `categories.max_concurrent_threads`
 * (falling back to the guild's general limit) by `categorySelect.ts` once a category is actually picked —
 * unlike the general limit above, a category can't be known until then, so this can't be checked any
 * earlier in the flow. Same combined-count shape as `countActiveTicketsForUser` above and for the same
 * reason: a category pick that's already created a private thread but is still waiting on the user's
 * opening message (`pending_tickets`, with `category_id` set the moment the pick resolves — see
 * `categorySelect.ts`) has no `threads` row yet, so counting `threads` alone would let a burst of picks
 * for the *same* category blow past its limit before any of them finish.
 */
export async function countOpenThreadsForUserInCategory(
	guildId: string,
	userId: string,
	categoryId: number,
): Promise<number> {
	const [row] = await getContext().db<[{ count: string }]>`
		SELECT (
			(SELECT COUNT(*) FROM threads
				WHERE guild_id = ${guildId} AND user_id = ${userId} AND category_id = ${categoryId} AND closed_at IS NULL) +
			(SELECT COUNT(*) FROM pending_tickets
				WHERE guild_id = ${guildId} AND user_id = ${userId} AND category_id = ${categoryId})
		) AS count
	`;

	return Number(row?.count ?? 0);
}

/**
 * Shown as a field on the ticket-opening embed (`lib/ticketCreation.ts`) — how many prior tickets
 * this user has had in the guild, closed or not, mirroring prod ChatSift/ModMail's "Past Modmails"
 * field.
 */
export async function countPastThreadsForUser(guildId: string, userId: string): Promise<number> {
	const [row] = await getContext().db<[{ count: string }]>`
		SELECT COUNT(*) FROM threads WHERE guild_id = ${guildId} AND user_id = ${userId}
	`;

	return Number(row?.count ?? 0);
}

/**
 * Looked up on every message posted anywhere, to check whether the channel is a ticket's private
 * thread (user → mod relay direction). Most channels won't match, hence the partial index on
 * `user_thread_id`.
 */
export async function findOpenThreadByUserThreadId(userThreadId: string): Promise<Threads | undefined> {
	const [thread] = await getContext().db<Threads[]>`
		SELECT * FROM threads WHERE user_thread_id = ${userThreadId} AND closed_at IS NULL
	`;

	return thread;
}

/**
 * Looked up whenever `/reply` or `/reply-q` runs, to resolve the ticket the command was invoked in
 * (mod → user relay direction) and reject the command outside of one.
 */
export async function findOpenThreadByModThreadId(modThreadId: string): Promise<Threads | undefined> {
	const [thread] = await getContext().db<Threads[]>`
		SELECT * FROM threads WHERE mod_thread_id = ${modThreadId} AND closed_at IS NULL
	`;

	return thread;
}

/**
 * Atomically reserves the next local per-thread message number. A gap can appear if the Discord
 * post that follows this call fails (accepted tradeoff, see relay.ts) — the numbering only needs to
 * stay monotonic and unique per thread, not gapless.
 */
export async function incrementLocalMessageId(threadId: Threads['id']): Promise<number> {
	const [row] = await getContext().db<[{ lastLocalThreadMessageId: number }]>`
		UPDATE threads
		SET last_local_thread_message_id = last_local_thread_message_id + 1
		WHERE id = ${threadId}
		RETURNING last_local_thread_message_id
	`;

	if (!row) {
		throw new Error(`Failed to increment local message id for thread ${threadId}`);
	}

	return row.lastLocalThreadMessageId;
}

/**
 * Resolves a Discord-native reply's target to the message id it was relayed as in the mod thread, so
 * the relay can link straight to it ("replying to [this message](...)") — mods never see our internal
 * local numbering, so that's not useful to reference here. Matches on `user_message_id` since that
 * column holds the id of whichever message actually appeared in the private thread (the user's own
 * message, or a relayed staff reply, both go through `insertThreadMessage`).
 */
export async function findRepliedToGuildMessageId(
	threadId: Threads['id'],
	userMessageId: string,
): Promise<string | undefined> {
	const [row] = await getContext().db<[{ guildMessageId: string }]>`
		SELECT guild_message_id FROM thread_messages WHERE thread_id = ${threadId} AND user_message_id = ${userMessageId}
	`;

	return row?.guildMessageId;
}

/**
 * Looked up by `/edit` and `/delete` to resolve the `Reply ID: N` a mod typed to the row it refers to.
 * `staff_id IS NOT NULL` excludes user messages -- they share the same per-thread numbering space but
 * were never given a `Reply ID:` footer (see `relay.ts`), so mods have no way to reference them this
 * way in the first place.
 */
export async function findStaffReplyByLocalId(
	threadId: Threads['id'],
	localThreadMessageId: number,
): Promise<ThreadMessages | undefined> {
	const [row] = await getContext().db<ThreadMessages[]>`
		SELECT * FROM thread_messages
		WHERE thread_id = ${threadId} AND local_thread_message_id = ${localThreadMessageId} AND staff_id IS NOT NULL
	`;

	return row;
}

/**
 * Looked up by the `MessageUpdate`/`MessageDelete` relay handlers to resolve a raw Discord message
 * id (all a `MESSAGE_DELETE` payload ever carries -- no local numbering, no author) back to its
 * `thread_messages` row. `staff_id IS NULL` scopes this to the user's own messages specifically --
 * a relayed staff-reply copy also lives in the same private thread, but that's `/edit`/`/delete`'s
 * territory (`findStaffReplyByLocalId` above), not this one's.
 */
export async function findUserThreadMessageByMessageId(
	threadId: Threads['id'],
	userMessageId: string,
): Promise<ThreadMessages | undefined> {
	const [row] = await getContext().db<ThreadMessages[]>`
		SELECT * FROM thread_messages
		WHERE thread_id = ${threadId} AND user_message_id = ${userMessageId} AND staff_id IS NULL
	`;

	return row;
}

export interface InsertThreadMessageOptions {
	anon: boolean;
	guildId: string;
	guildMessageId: string;
	localThreadMessageId: number;
	staffId: string | null;
	threadId: Threads['id'];
	userId: string;
	userMessageId: string;
}

export async function insertThreadMessage({
	anon,
	guildId,
	guildMessageId,
	localThreadMessageId,
	staffId,
	threadId,
	userId,
	userMessageId,
}: InsertThreadMessageOptions): Promise<void> {
	await getContext().db`
		INSERT INTO thread_messages (
			local_thread_message_id, guild_id, thread_id, user_id, user_message_id, staff_id, guild_message_id, anon
		) VALUES (
			${localThreadMessageId}, ${guildId}, ${threadId}, ${userId}, ${userMessageId}, ${staffId}, ${guildMessageId}, ${anon}
		)
	`;
}
