import type Redis from 'ioredis';
import type { ITransformer } from '../transformers/ITransformer';

export abstract class Cache<T> {
	protected abstract readonly redis: Redis;
	protected abstract readonly transformer: ITransformer<T>;
	protected abstract readonly TTL: number;

	protected abstract makeKey(id: string): string;

	public async has(id: string): Promise<boolean> {
		return Boolean(await this.redis.exists(this.makeKey(id)));
	}

	public async get(id: string): Promise<T | null> {
		const key = this.makeKey(id);
		const raw = await this.redis.getBuffer(key);

		if (!raw) {
			return null;
		}

		await this.redis.pexpire(key, this.TTL);
		return this.transformer.toJSON(raw);
	}

	public async getOld(id: string): Promise<T | null> {
		const key = `old:${this.makeKey(id)}`;
		const raw = await this.redis.getBuffer(key);

		if (!raw) {
			return null;
		}

		await this.redis.pexpire(key, this.TTL);
		return this.transformer.toJSON(raw);
	}

	public async set(id: string, value: T): Promise<void> {
		const key = this.makeKey(id);
		if (await this.redis.exists(key)) {
			await this.redis.rename(key, `old:${key}`);
			await this.redis.pexpire(`old:${key}`, this.TTL);
		}

		const raw = this.transformer.toBuffer(value);
		await this.redis.set(key, raw, 'PX', this.TTL);
	}

	public async delete(id: string) {
		const key = this.makeKey(id);
		await this.redis.del(key, `old:${key}`);
	}
}

export type CacheConstructor<T> = new (...args: any[]) => Cache<T>;
