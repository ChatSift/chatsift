import { inject, injectable } from 'inversify';
import { Redis } from 'ioredis';
import { INJECTION_TOKENS } from '../container.js';
import type { ICache } from './ICache.js';
import type { ICacheEntity } from './ICacheEntity.js';
import { RedisCache } from './RedisCache.js';

/**
 * @remarks
 * Since this is a singleton factroy, we "cache our caches" in a WeakMap to avoid additional computation on subsequent calls.
 */
@injectable()
export class CacheFactory {
	private readonly caches = new WeakMap<ICacheEntity<unknown>, ICache<unknown>>();

	public constructor(@inject(INJECTION_TOKENS.redis) private readonly redis: Redis) {}

	public build<ValueType>(entity: ICacheEntity<ValueType>): ICache<ValueType> {
		if (this.caches.has(entity)) {
			return this.caches.get(entity)! as ICache<ValueType>;
		}

		const cache = new RedisCache<ValueType>(this.redis, entity);
		this.caches.set(entity, cache);

		return cache;
	}
}
