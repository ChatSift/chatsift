/* eslint-disable tsdoc/syntax */

/**
 * Transforms an object of promises into a promise of an object where all the values are awaited, much like
 * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all | Promise.all}.
 *
 * @remarks
 * This is the flow we follow:
 *
 * { a: Promise<X>, b: Promise<Y> }
 *
 * => [ ['a', Promise<X>], ['b', Promise<Y>] ]
 *
 * => [ Promise<['a', X]>, Promise<'b', Y>] ]
 *
 * => (via awaited Promise.all) [ ['a', X], ['b', Y] ]
 *
 * => Promise<{ a: X, b: Y }>
 */
export async function promiseAllObject<TRecord extends Record<string, Promise<any>>>(
	obj: TRecord,
): Promise<{ [K in keyof TRecord]: Awaited<TRecord[K]> }> {
	return Object.fromEntries(await Promise.all(Object.entries(obj).map(async ([key, value]) => [key, await value])));
}
