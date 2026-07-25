import { getContext } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';

/**
 * A user may only have one open ticket per guild at a time — this is what a new
 * `modmail-create-ticket` click checks before opening another private thread.
 */
export async function findOpenThreadForUser(guildId: string, userId: string): Promise<Threads | undefined> {
	const [thread] = await getContext().db<Threads[]>`
		SELECT * FROM threads WHERE guild_id = ${guildId} AND user_id = ${userId} AND closed_at IS NULL
	`;

	return thread;
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
