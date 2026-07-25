import { AsyncQueue } from '@sapphire/async-queue';

const queues = new Map<string, AsyncQueue>();

function keyFor(guildId: string, userId: string): string {
	return `${guildId}:${userId}`;
}

/**
 * Serializes every ticket-lifecycle event (button click, category pick, first message) for a given
 * guild+user pair — mirrors discord.js/ws's `SimpleIdentifyThrottler` (one `AsyncQueue` per key, held
 * in a map). Guild-scoped rather than global per-user, since a user may eventually be allowed a
 * concurrent ticket per guild. This alone doesn't stop a *second*, later click from creating a
 * duplicate pending ticket — only truly concurrent callers race each other — so callers still need to
 * check `PendingTicketByUserStore` (see `pendingTicket.ts`) for an already-in-progress ticket once
 * they hold the lock.
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
