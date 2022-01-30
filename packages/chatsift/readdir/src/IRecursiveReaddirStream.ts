import type { TypedEmitter } from 'tiny-typed-emitter';
import type { Readable, ReadableOptions } from 'stream';
import type { EventEmitter } from 'events';

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
	fileExtensions?: string[] | Set<string>;
	/**
	 * The read mode to use
	 */
	readMode?: ReadMode;
	/**
	 * Passed straight into the parent constructor.
	 * For more information see https://nodejs.org/api/stream.html#stream_buffering
	 * @default 1000
	 */
	highWaterMark?: number;
}

/**
 * @internal
 */
export interface RecursiveReaddirStreamEvents {
	/**
	 * @event
	 */
	end: () => Awaited<void>;
	/**
	 * @event
	 */
	data: (file: string) => Awaited<void>;
	/**
	 * @event
	 */
	warn: (error: Error) => Awaited<void>;
	/**
	 * @event
	 */
	error: (error: Error) => Awaited<void>;
}

/**
 * @internal
 */
type TypedReadable = {
	[K in Exclude<keyof Readable, keyof EventEmitter>]: Readable[K];
} & TypedEmitter<RecursiveReaddirStreamEvents>;

/**
 * @internal
 */
export type TypedReadableConstructor = new (opts?: ReadableOptions) => TypedReadable;

/**
 * @internal
 */
export interface IRecursiveReaddirStream extends TypedReadable {
	[Symbol.asyncIterator]: () => AsyncIterableIterator<string>;
}
