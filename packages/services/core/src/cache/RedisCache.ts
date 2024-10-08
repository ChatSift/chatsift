import type Redis from 'ioredis';
import type { ICache } from './ICache.js';
import type { ICacheEntity } from './ICacheEntity.js';

/**
 * @remarks
 * This class is deliberately not an `@injectable()`, refer to the README for more information on the pattern
 * being used.
 */
export class RedisCache<ValueType> implements ICache<ValueType> {
	public constructor(
		private readonly redis: Redis,
		private readonly entity: ICacheEntity<ValueType>,
	) {}

	public async has(id: string): Promise<boolean> {
		return Boolean(await this.redis.exists(this.entity.makeKey(id)));
	}

	public async get(id: string): Promise<ValueType | null> {
		const key = this.entity.makeKey(id);
		const raw = await this.redis.getBuffer(key);

		if (!raw) {
			return null;
		}

		await this.redis.pexpire(key, this.entity.TTL);
		return this.entity.recipe.decode(raw);
	}

	public async getOld(id: string): Promise<ValueType | null> {
		const key = `old:${this.entity.makeKey(id)}`;
		const raw = await this.redis.getBuffer(key);

		if (!raw) {
			return null;
		}

		await this.redis.pexpire(key, this.entity.TTL);
		return this.entity.recipe.decode(raw);
	}

	public async set(id: string, value: ValueType): Promise<void> {
		const key = this.entity.makeKey(id);
		if (await this.redis.exists(key)) {
			await this.redis.rename(key, `old:${key}`);
			await this.redis.pexpire(`old:${key}`, this.entity.TTL);
		}

		const raw = this.entity.recipe.encode(value);
		await this.redis.set(key, raw, 'PX', this.entity.TTL);
	}

	public async delete(id: string) {
		const key = this.entity.makeKey(id);
		await this.redis.del(key, `old:${key}`);
	}
}
