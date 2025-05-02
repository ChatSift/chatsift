/**
 * This is a fork/rewrite of https://www.npmjs.com/package/readdirp
 *
 *
 * MIT License
 *
 * Copyright (c) 2012-2019 Thorsten Lorenz, Paul Miller (https://paulmillr.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

import { readdir, stat } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { Readable as RawReadable } from 'node:stream';
import type { EventEmitter, ReadableOptions } from 'node:stream';
import type { TypedEmitter } from 'tiny-typed-emitter';

/**
 * Read modes for the stream
 */
export enum ReadMode {
	/**
	 * Causes the reader to only output file paths
	 */
	file,
	/**
	 * Causes the reader to only output directory paths
	 */
	dir,
	/**
	 * Causes the reader to output both
	 */
	both,
}

/**
 * Options for the stream
 */
export interface RecursiveReaddirStreamOptions {
	/**
	 * File extensions to check for
	 */
	fileExtensions?: Set<string> | string[];
	/**
	 * Passed straight into the parent constructor.
	 * For more information see https://nodejs.org/api/stream.html#stream_buffering
	 *
	 * @default 1000
	 */
	highWaterMark?: number;
	/**
	 * The read mode to use
	 */
	readMode?: ReadMode;
}

/**
 * Represents a "node" (directory) in the file system
 *
 * @internal
 */
interface Node {
	/**
	 * How many layers deep this directory is - relative from the starting path
	 */
	depth: number;
	/**
	 * Files included in the directory - will be undefined if the readdir call failed, triggering the error handler
	 */
	files?: string[];
	/**
	 * Absolute path to this directory
	 */
	path: string;
}

/**
 * @internal
 */
interface RecursiveReaddirStreamEvents {
	/**
	 * @event RecursiveReaddirStream#data
	 */
	data(file: string): void;
	/**
	 * @event RecursiveReaddirStream#end
	 */
	end(): void;
	/**
	 * @event RecursiveReaddirStream#error
	 */
	error(error: Error): void;
	/**
	 * @event RecursiveReaddirStream#warn
	 */
	warn(error: Error): void;
}

/**
 * @internal
 */
type TypedReadable = TypedEmitter<RecursiveReaddirStreamEvents> & {
	[K in Exclude<keyof RawReadable, keyof EventEmitter>]: RawReadable[K];
};

const Readable = RawReadable as new (opts?: ReadableOptions) => TypedReadable;

/**
 * A Node.JS readable implementation that recurses down a given directory.
 *
 * Any errors encountered not included in {@link RecursiveReaddirStream.EXPECTED_ERRORS} will cause the stream to be destroyed
 */
export class RecursiveReaddirStream extends Readable {
	/**
	 * Recoverable/expected errors - when found they cause a "warn" event
	 */
	public static readonly EXPECTED_ERRORS = new Set(['ENOENT', 'EPERM', 'EACCES', 'ELOOP']);

	/**
	 * Valid file extensions for this read operation
	 */
	readonly #fileExtensions: Set<string>;

	/**
	 * Read mode this stream is in - see {@link RecursiveReaddirStreamOptions.readMode}
	 */
	readonly #readMode: ReadMode;

	/**
	 * Unconsumed and unresolved {@link Node}s to go through
	 *
	 * @internal
	 */
	readonly #nodes: Promise<Node>[];

	/**
	 * Current node being consumed
	 */
	#currentNode?: Node;

	/**
	 * Wether data is currently being read or not
	 */
	#reading = false;

	/**
	 * @param root - Where to start reading from
	 * @param options - Additional reading options
	 */
	public constructor(root: string, options?: RecursiveReaddirStreamOptions) {
		super({
			objectMode: true,
			encoding: 'utf8',
			highWaterMark: options?.highWaterMark ?? 1_000,
		});

		void (this.#nodes = [this.explore(root, 0)]);
		this.#fileExtensions = new Set(options?.fileExtensions ?? []);
		this.#readMode = options?.readMode ?? ReadMode.file;
	}

	/**
	 * Handles an error event encountered while reading
	 *
	 * @internal
	 */
	private handleError(error: Error & { code?: any }): void {
		if (typeof error.code === 'string' && RecursiveReaddirStream.EXPECTED_ERRORS.has(error.code) && !this.destroyed) {
			return void this.emit('warn', error);
		}

		this.destroy(error);
	}

	/**
	 * "Explores" further down the file system
	 *
	 * @param path - Absolute path to "explore"
	 * @param depth - How deep this path is relative to the root
	 * @internal
	 */
	private async explore(path: string, depth: number): Promise<Node> {
		let files: string[] | undefined;
		try {
			files = await readdir(path);
		} catch (error) {
			this.handleError(error as Error);
		}

		return { files, depth: depth + 1, path };
	}

	// Base readable class requires this to be public
	/**
	 * @internal
	 */
	public override _read = async (batch: number): Promise<void> => {
		if (this.#reading) {
			return;
		}

		this.#reading = true;

		try {
			while (!this.destroyed && batch > 0) {
				if (this.#currentNode?.files && this.#currentNode.files.length > 0) {
					const { files = [], depth, path } = this.#currentNode;

					for (const entry of files.splice(0, batch)) {
						if (this.destroyed) {
							return;
						}

						const full = joinPath(path, entry);

						try {
							const statResult = await stat(full);

							if (statResult.isDirectory()) {
								this.#nodes.push(this.explore(full, depth));
								if (this.#readMode !== ReadMode.file) {
									this.push(full);
								}
							} else if (
								this.#readMode !== ReadMode.dir &&
								(!this.#fileExtensions.size || this.#fileExtensions.has(entry.split('.').pop() ?? ''))
							) {
								this.push(full);
							}
						} catch (error) {
							this.handleError(error as Error);
						}

						// eslint-disable-next-line no-param-reassign
						batch--;
					}
				} else {
					const parent = this.#nodes.pop();
					if (!parent) {
						this.push(null);
						break;
					}

					this.#currentNode = await parent;

					if (this.destroyed) {
						return;
					}
				}
			}
		} catch (error) {
			this.destroy(error as Error);
		} finally {
			this.#reading = false;
		}
	};

	// @ts-expect-error - Overwriting base type
	public [Symbol.asyncIterator](): AsyncIterableIterator<string>;
}
