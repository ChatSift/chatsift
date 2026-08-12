import { AsyncQueue } from '@sapphire/async-queue';

const queues = new Map<string, AsyncQueue>();

/**
 * One `AsyncQueue` per arbitrary string key, held in a map -- mirrors discord.js/ws's `SimpleIdentifyThrottler`.
 * Shared by every named lock built on top of it rather than duplicated per key-shape; callers are responsible
 * for namespacing their own keys so two unrelated locks (e.g. a guild+user pair versus a message id) can never
 * collide.
 *
 * Process-local, so it serializes one replica against itself and nothing more. That's the right scope for the
 * things it guards -- a gateway event for a given guild+user is delivered to exactly one process.
 */
export async function withQueueLock<Result>(key: string, fn: () => Promise<Result>): Promise<Result> {
	const queue = queues.get(key) ?? new AsyncQueue();
	queues.set(key, queue);

	await queue.wait();
	try {
		return await fn();
	} finally {
		queue.shift();
		// Unbounded key space over the bot's lifetime (guild+user pairs, message ids, ...) -- prune the map
		// entry once its queue is empty instead of holding onto it forever.
		if (queue.remaining === 0) {
			queues.delete(key);
		}
	}
}

/**
 * Serializes everything a bot does for one guild+user pair.
 *
 * ModMail uses it to order a user's ticket-lifecycle events (button click, category pick, first message); Social
 * uses it to make XP tracking read-modify-write safely, so two messages arriving together can't both clear the
 * eligibility window before either sets its bar.
 *
 * Guild-scoped rather than global per-user, since the same user acting in two guilds has nothing to serialize.
 */
export async function withGuildUserLock<Result>(
	guildId: string,
	userId: string,
	fn: () => Promise<Result>,
): Promise<Result> {
	return withQueueLock(`guildUser:${guildId}:${userId}`, fn);
}
