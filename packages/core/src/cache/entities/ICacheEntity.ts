import type { Buffer } from 'node:buffer';

/**
 * Responsible for defining the behavior of a given entity when its being cached.
 */
export interface ICacheEntity<TData> {
	/**
	 * How long an entity of this type should remain in the cache without any operations being performed on it.
	 */
	readonly TTL: number;
	/**
	 * Generates a redis key for this entity.
	 */
	makeKey(id: string): string;
	/**
	 * Transforms the data into a buffer that can be stored in redis.
	 */
	toBuffer(data: TData): Buffer;
	/**
	 * Transforms the data from a buffer back into a readable object.
	 */
	toJSON(data: Buffer): TData;
}
