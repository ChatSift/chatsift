import { AsyncQueue } from '@sapphire/async-queue';

const queues = new Map<string, AsyncQueue>();

/**
 * One `AsyncQueue` per arbitrary string key, held in a map — mirrors discord.js/ws's
 * `SimpleIdentifyThrottler`. Shared by every named lock below rather than duplicated per key-shape;
 * callers are responsible for namespacing their own keys so two unrelated locks (e.g. a guild+user pair
 * versus a message id) can never collide.
 */
async function withQueueLock<Result>(key: string, fn: () => Promise<Result>): Promise<Result> {
	const queue = queues.get(key) ?? new AsyncQueue();
	queues.set(key, queue);

	await queue.wait();
	try {
		return await fn();
	} finally {
		queue.shift();
		// Unbounded key space over the bot's lifetime (guild+user pairs, message ids, ...) — prune the
		// map entry once its queue is empty instead of holding onto it forever.
		if (queue.remaining === 0) {
			queues.delete(key);
		}
	}
}

/**
 * Serializes every ticket-lifecycle event (button click, category pick, first message) for a given
 * guild+user pair. Guild-scoped rather than global per-user, since a user is allowed multiple concurrent
 * tickets per guild (up to `guild_settings.max_concurrent_threads`, see `lib/threads.ts`'s
 * `countActiveTicketsForUser`). This alone doesn't stop a *second*, later click from creating one ticket
 * too many — only truly concurrent callers race each other — so callers still need to check that count
 * against the guild's limit once they hold the lock (see `createTicket.ts`).
 */
export async function withGuildUserLock<Result>(
	guildId: string,
	userId: string,
	fn: () => Promise<Result>,
): Promise<Result> {
	return withQueueLock(`guildUser:${guildId}:${userId}`, fn);
}

/**
 * Serializes fetch-check-write sequences against one mod-forum log message id — `lib/userMessageLifecycle.ts`'s
 * `handleUserMessageUpdate` and `handleUserMessageDelete` both read a log message's current embed, decide
 * whether it's already marked deleted, and then edit it, and both can fire for the same message in quick
 * succession (a user editing a message and then immediately deleting it). Without this, the two handlers'
 * read-then-write windows can interleave: an edit that read the embed before a delete's write would
 * otherwise clobber the "deleted" mark with stale (edited) content once its own write lands after. Keyed
 * by the Discord message id alone (globally unique) rather than needing the guild/thread too.
 */
export async function withMessageLock<Result>(guildMessageId: string, fn: () => Promise<Result>): Promise<Result> {
	return withQueueLock(`message:${guildMessageId}`, fn);
}
