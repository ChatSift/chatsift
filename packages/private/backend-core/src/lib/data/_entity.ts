import type { Recipe } from 'bin-rw';

/**
 * Responsible for defining the behavior of a given entity.
 */
export interface IEntity<TData> {
	/**
	 * How long an entity of this entity should remain in the store without any operations being performed on it.
	 */
	readonly TTL: number | null;
	/**
	 * Generates a redis key for this entity.
	 */
	makeKey(id: string): string;
	/**
	 * Recipe for encoding and decoding TData.
	 */
	readonly recipe: Recipe<TData>;
}
