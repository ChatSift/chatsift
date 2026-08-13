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
	/**
	 * Whether reading an entry slides its `TTL` forward (the default, `true`).
	 *
	 * Set `false` when the TTL means "this writer is still alive" rather than "this value is still wanted" --
	 * a liveness lease can't be kept alive by the people reading it. `data/bots.ts` is the case that needs it
	 * (#355): every replica publishes its own guild slice on a heartbeat, so a replica that died must age out
	 * even though the dashboard is reading the union constantly.
	 */
	readonly refreshTTLOnRead?: boolean | undefined;
	/**
	 * Whether or not to store the previous version of the entity when setting a new value.
	 */
	readonly storeOld: boolean;
}
