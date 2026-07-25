import { AsyncQueue } from '@sapphire/async-queue';

const queues = new Map<string, AsyncQueue>();

function keyFor(guildId: string, userId: string): string {
	return `${guildId}:${userId}`;
}

/**
 * Serializes every ticket-lifecycle event (button click, category pick, first message) for a given
 * guild+user pair — mirrors discord.js/ws's `SimpleIdentifyThrottler` (one `AsyncQueue` per key, held
 * in a map). Guild-scoped rather than global per-user, since a user is allowed multiple concurrent
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
	const key = keyFor(guildId, userId);
	const queue = queues.get(key) ?? new AsyncQueue();
	queues.set(key, queue);

	await queue.wait();
	try {
		return await fn();
	} finally {
		queue.shift();
		// Unlike shard ids (a small, fixed count), guild+user pairs are unbounded over the bot's
		// lifetime — prune the map entry once its queue is empty instead of holding onto it forever.
		if (queue.remaining === 0) {
			queues.delete(key);
		}
	}
}
