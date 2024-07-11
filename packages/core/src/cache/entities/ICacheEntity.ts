import type { Recipe } from 'bin-rw';

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
	 * Recipe for encoding and decoding TData.
	 */
	readonly recipe: Recipe<TData>;
}
