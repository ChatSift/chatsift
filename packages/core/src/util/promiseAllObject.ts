export async function promiseAllObject<T extends Record<string, Promise<any>>>(
	obj: T,
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
	return Object.fromEntries(await Promise.all(Object.entries(obj).map(async ([key, value]) => [key, await value])));
}

// { a: Promise<X>, b: Promise<Y> }
// => [ ['a', Promise<X>], ['b', Promise<Y>] ]
// => [ Promise<['a', X]>, Promise<'b', Y>] ]
// => (via awaited Promise.all) [ ['a', X], ['b', Y] ]
// => Promise<{ a: X, b: Y }>
