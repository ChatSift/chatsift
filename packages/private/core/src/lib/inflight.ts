export interface InflightDeduper {
	/**
	 * Runs `fetch` under `key`, or joins the run already in flight for that key.
	 *
	 * The entry is cleared when the promise settles, including on rejection -- a failed attempt must not be
	 * remembered as the answer for every later caller.
	 */
	run<TValue>(key: string, fetch: () => Promise<TValue>): Promise<TValue>;
}

/**
 * Memoizes a single async lookup for the lifetime of the process, **without remembering a failure**.
 *
 * For a value that is genuinely constant and costs a round trip to learn -- the bot's own user id, an
 * application id. The failure half is the part worth having in one place: caching the promise is the obvious
 * way to write this, and it quietly means one transient 503 on the first call makes every later caller fail
 * forever. `bot-core`'s `/deploy` bootstrap (`client.ts`) learned that the hard way and clears on failure for
 * the same reason; it keeps its own copy because its retry is entangled with logging the failure it swallows.
 *
 * Unlike {@link createInflightDeduper}, a settled *success* is kept -- that's the difference between "don't
 * duplicate concurrent work" and "only ever do this once".
 */
export function memoizeAsync<TValue>(fetch: () => Promise<TValue>): () => Promise<TValue> {
	let cached: Promise<TValue> | null = null;

	const attempt = async (): Promise<TValue> => {
		// bit of a hack to deal with a `fetch` being sync and potentially immediately throwing
		await Promise.resolve();

		try {
			return await fetch();
		} catch (error) {
			// Cleared before rethrowing, so the next caller retries rather than inheriting this failure. Safe to
			// reassign mid-flight: anyone already awaiting captured the promise before this ran.
			cached = null;
			throw error;
		}
	};

	return async () => {
		cached ??= attempt();
		return cached;
	};
}

/**
 * Collapses concurrent work for the same key onto a single promise.
 *
 * The usual shape is a read-through cache: several callers miss at once and would each issue the same expensive
 * fetch, so the first one's promise is shared and the rest ride along. Deliberately *only* an in-flight guard --
 * it holds nothing once a promise settles, so it never doubles as a cache and can't serve a stale value.
 *
 * Pure and platform-agnostic (no timers, no I/O), which is why it lives here rather than in a backend package.
 */
export function createInflightDeduper(): InflightDeduper {
	const inflight = new Map<string, Promise<unknown>>();

	return {
		async run<TValue>(key: string, fetch: () => Promise<TValue>): Promise<TValue> {
			const existing = inflight.get(key) as Promise<TValue> | undefined;
			if (existing) {
				return existing;
			}

			// eslint-disable-next-line promise/prefer-await-to-then
			const promise = fetch().finally(() => inflight.delete(key));
			inflight.set(key, promise);

			return promise;
		},
	};
}
