import { inject, injectable } from 'inversify';
import { Redis } from 'ioredis';
import { INJECTION_TOKENS } from '../singletons/DependencyManager.js';
import { Cache } from './Cache.js';
import type { ICacheEntity } from './entities/ICacheEntity';

@injectable()
export class CacheFactory {
	public constructor(@inject(INJECTION_TOKENS.redis) private readonly redis: Redis) {}

	public build<T>(entity: ICacheEntity<T>): Cache<T> {
		return new Cache<T>(this.redis, entity);
	}
}
