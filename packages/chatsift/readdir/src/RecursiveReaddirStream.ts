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

import { readdir, stat } from 'fs/promises';
import { join as joinPath } from 'path';
import {
	TypedReadableConstructor,
	IRecursiveReaddirStream,
	ReadMode,
	RecursiveReaddirStreamOptions,
	RecursiveReaddirStreamEvents,
} from './IRecursiveReaddirStream';
import { Readable as RawReadable } from 'stream';

const Readable = RawReadable as TypedReadableConstructor;

/**
 * Represents a "node" (directory) in the file system
 * @internal
 */
interface Node {
	/**
	 * Files included in the directory - will be undefined if the readdir call failed, triggering the error handler
	 */
	files?: string[];
	/**
	 * How many layers deep this directory is - relative from the starting path
	 */
	depth: number;
	/**
	 * Absolute path to this directory
	 */
	path: string;
}

// Documentation purposes
export interface RecursiveReaddirStream extends RecursiveReaddirStreamEvents {}

/**
 * A Node.JS readable implementation that recurses down a given directory.
 *
 * Any errors encountered not included in {@link RecursiveReaddirStream.EXPECTED_ERRORS} will cause the stream to be destroyed
 */
export class RecursiveReaddirStream extends Readable implements IRecursiveReaddirStream {
	/**
	 * Recoverable/expected errors - when found they cause a "warn" event
	 */
	public static readonly EXPECTED_ERRORS = new Set(['ENOENT', 'EPERM', 'EACCES', 'ELOOP']);
	/**
	 * Valid file extensions for this read operation
	 */
	private readonly _fileExtensions: Set<string>;
	/**
	 * Read mode this stream is in - see {@link RecursiveReaddirStreamOptions.readMode}
	 */
	private readonly _readMode: ReadMode;
	/**
	 * Unconsumed and unresolved {@link Node}s to go through
	 * @internal
	 */
	private readonly _nodes: Promise<Node>[];
	/**
	 * Current node being consumed
	 */
	private _currentNode?: Node;
	/**
	 * Wether data is currently being read or not
	 */
	private _reading = false;

	/**
	 * @param root Where to start reading from
	 * @param options Additional reading options
	 */
	public constructor(root: string, options?: RecursiveReaddirStreamOptions) {
		super({
			objectMode: true,
			encoding: 'utf8',
			highWaterMark: options?.highWaterMark ?? 1000,
		});

		this._nodes = [this._explore(root, 0)];
		this._fileExtensions = new Set(options?.fileExtensions ?? []);
		this._readMode = options?.readMode ?? ReadMode.file;
	}

	/**
	 * Handles an error event encountered while reading
	 * @internal
	 */
	private _handleError(error: Error & { code?: any }): void {
		if (typeof error.code === 'string' && RecursiveReaddirStream.EXPECTED_ERRORS.has(error.code) && !this.destroyed) {
			return void this.emit('warn', error);
		}

		return this.destroy(error);
	}

	/**
	 * "Explores" further down the file system
	 * @param path Absolute path to "explore"
	 * @param depth How deep this path is relative to the root
	 * @internal
	 */
	private async _explore(path: string, depth: number): Promise<Node> {
		let files: string[] | undefined;
		try {
			files = await readdir(path);
		} catch (error) {
			this._handleError(error as Error);
		}

		return { files, depth: depth + 1, path };
	}

	// Base readable class requires this to be public
	/**
	 * @internal
	 */
	public override _read = async (batch: number): Promise<void> => {
		if (this._reading) {
			return;
		}

		this._reading = true;

		try {
			while (!this.destroyed && batch > 0) {
				if (this._currentNode?.files && this._currentNode.files.length > 0) {
					const { files = [], depth, path } = this._currentNode;

					for (const entry of files.splice(0, batch)) {
						// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
						if (this.destroyed) {
							return;
						}

						const full = joinPath(path, entry);

						try {
							const statResult = await stat(full);

							if (statResult.isDirectory()) {
								this._nodes.push(this._explore(full, depth));
								if (this._readMode !== ReadMode.file) {
									this.push(full);
								}
							} else if (
								this._readMode !== ReadMode.dir &&
								(!this._fileExtensions.size || this._fileExtensions.has(entry.split('.').pop() ?? ''))
							) {
								this.push(full);
							}
						} catch (error) {
							this._handleError(error as Error);
						}

						batch--;
					}
				} else {
					const parent = this._nodes.pop();
					if (!parent) {
						this.push(null);
						break;
					}

					this._currentNode = await parent;

					// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
					if (this.destroyed) {
						return;
					}
				}
			}
		} catch (error) {
			this.destroy(error as Error);
		} finally {
			this._reading = false;
		}
	};

	// @ts-expect-error - Overwriting base type
	public [Symbol.asyncIterator](): AsyncIterableIterator<string>;
}
