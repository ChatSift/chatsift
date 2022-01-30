/**
 * Creates a union type from 2 sub-types: `T` itself and `T` where all the `K` keys become null.
 * @example
 * ```ts
 * type Data = NullableProperties<{ x: string; y: string; z: string }, 'x' | 'y'>; // { x: string; y: string; z: string } | { x: null; y: null; z: string }
 * ```
 */
export type NullableProperties<T extends Record<string, any>, K extends keyof T> =
	| T
	| {
			[P in keyof T]: P extends K ? null : T[P];
	  };

/**
 * Gets the `T` type from a `T[]` type.
 * @example
 * ```ts
 * type Data = (string | number | Very | Complex | Union)[];
 * type T = ArrayT<Data>; // string | number | Very | Complex | Union
 * ```
 */
export type ArrayT<Ts> = Ts extends (infer T)[] ? T : never;

/**
 * "Groups" the elements of an array based off of a grouper function
 * @param array The array to group
 * @param grouper Function returning a key for each element
 * @example
 * ```ts
 * const data = [0, 1, 2, 3, 4, 5, 6];
 * const grouper = (x: number) => x % 2 === 0 ? 'even' : 'odd';
 * const grouped = groupBy(data, grouper); // { even: [0, 2, 4, 6], odd: [1, 3, 5] }
 * ```
 */
export function groupBy<T, R extends string>(array: T[], grouper: (element: T) => R): Record<R, T[]> {
	const grouped = {} as Record<R, T[]>; // eslint-disable-line @typescript-eslint/consistent-type-assertions

	for (const element of array) {
		(grouped[grouper(element)] ??= []).push(element);
	}

	return grouped;
}

/**
 * Splits an array into chunks of a given size
 * @param array The array to split
 * @param size How big each chunk should be
 * @example
 * ```ts
 * const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 * const chunks = chunkArray(data, 3); // [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]
 * ```
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
	const out: T[][] = [];
	let pushed = 0;
	let i = 0;

	for (const element of array) {
		(out[i] ??= []).push(element);
		if (++pushed === size) {
			pushed = 0;
			i++;
		}
	}

	return out;
}
