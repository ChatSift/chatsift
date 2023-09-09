import { inject, injectable } from 'inversify';
import { Redis } from 'ioredis';
import { INJECTION_TOKENS } from '../singletons/DependencyManager.js';
import { Cache } from './Cache.js';
import type { ICacheEntity } from './entities/ICacheEntity';

@injectable()
/**
 * @remarks
 * Since this is a singleton factroy, we "cache our caches" in a WeakMap to avoid additional computation on subsequent calls.
 */
export class CacheFactory {
	private readonly caches = new WeakMap<ICacheEntity<unknown>, Cache<unknown>>();

	public constructor(@inject(INJECTION_TOKENS.redis) private readonly redis: Redis) {}

	public build<T>(entity: ICacheEntity<T>): Cache<T> {
		if (this.caches.has(entity)) {
			return this.caches.get(entity)! as Cache<T>;
		}

		const cache = new Cache<T>(this.redis, entity);
		this.caches.set(entity, cache);

		return cache;
	}
}
