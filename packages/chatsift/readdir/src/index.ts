import { RecursiveReaddirStream } from './RecursiveReaddirStream';
import type { RecursiveReaddirStreamOptions } from './IRecursiveReaddirStream';

export * from './IRecursiveReaddirStream';
export * from './RecursiveReaddirStream';

/**
 * Recursively and asynchronously reads a directory, returning an iterable that can be consumed as the filesystem is traversed
 * @param root Where to start reading from
 * @returns An async iterable of paths
 * @example
 * ```ts
 * const files = await readdirRecurse('/path/to/dir');
 *
 * for await (const file of files) {
 * 	console.log(file);
 * }
 * ```
 */
export function readdirRecurse(root: string, options?: RecursiveReaddirStreamOptions): RecursiveReaddirStream {
	return new RecursiveReaddirStream(root, options);
}

/**
 * Recursively and asynchronously traverses a directory, returning an array of all the paths
 * @param root Where to start reading from
 * @param options
 * @returns An array of paths
 * @example
 * ```ts
 * const files = await readdirRecurseAsync('/path/to/dir');
 * console.log(files);
 * ```
 */
export function readdirRecurseAsync(root: string, options?: RecursiveReaddirStreamOptions): Promise<string[]> {
	return new Promise<string[]>((resolve, reject) => {
		const files: string[] = [];
		new RecursiveReaddirStream(root, options)
			.once('end', () => resolve(files))
			.on('data', (file) => files.push(file))
			.on('error', (error) => reject(error));
	});
}
