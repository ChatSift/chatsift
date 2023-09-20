import type Redis from 'ioredis';
import type { ICache } from './ICache.js';
import type { ICacheEntity } from './entities/ICacheEntity.js';

/**
 * @remarks
 * This class is deliberately not an `@injectable()`, refer to the README for more information on the pattern
 * being used.
 */
export class Cache<T> implements ICache<T> {
	public constructor(
		private readonly redis: Redis,
		private readonly entity: ICacheEntity<T>,
	) {}

	public async has(id: string): Promise<boolean> {
		return Boolean(await this.redis.exists(this.entity.makeKey(id)));
	}

	public async get(id: string): Promise<T | null> {
		const key = this.entity.makeKey(id);
		const raw = await this.redis.getBuffer(key);

		if (!raw) {
			return null;
		}

		await this.redis.pexpire(key, this.entity.TTL);
		return this.entity.toJSON(raw);
	}

	public async getOld(id: string): Promise<T | null> {
		const key = `old:${this.entity.makeKey(id)}`;
		const raw = await this.redis.getBuffer(key);

		if (!raw) {
			return null;
		}

		await this.redis.pexpire(key, this.entity.TTL);
		return this.entity.toJSON(raw);
	}

	public async set(id: string, value: T): Promise<void> {
		const key = this.entity.makeKey(id);
		if (await this.redis.exists(key)) {
			await this.redis.rename(key, `old:${key}`);
			await this.redis.pexpire(`old:${key}`, this.entity.TTL);
		}

		const raw = this.entity.toBuffer(value);
		await this.redis.set(key, raw, 'PX', this.entity.TTL);
	}

	public async delete(id: string) {
		const key = this.entity.makeKey(id);
		await this.redis.del(key, `old:${key}`);
	}
}
