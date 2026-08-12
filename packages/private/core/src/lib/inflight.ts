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
