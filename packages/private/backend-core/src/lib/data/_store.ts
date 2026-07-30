import type { Buffer } from 'node:buffer';
import { getContext } from '../context.js';
import type { IEntity } from './_entity.js';

export class RedisStore<ValueType, KeyType extends string = string> {
	public constructor(private readonly entity: IEntity<ValueType>) {}

	public async has(id: KeyType): Promise<boolean> {
		return Boolean(await getContext().redis.exists(this.entity.makeKey(id)));
	}

	public async get(id: KeyType): Promise<ValueType | null> {
		const key = this.entity.makeKey(id);
		const raw = await getContext().redis.get(key);

		if (!raw) {
			return null;
		}

		if (this.entity.TTL) {
			await getContext().redis.pExpire(key, this.entity.TTL);
		}

		return this.decodeOrEvict(key, raw);
	}

	public async getOld(id: KeyType): Promise<ValueType | null> {
		if (!this.entity.storeOld) {
			throw new Error('Old value storage is not enabled for this entity.');
		}

		const key = `old:${this.entity.makeKey(id)}`;
		const raw = await getContext().redis.get(key);

		if (!raw) {
			return null;
		}

		if (this.entity.TTL) {
			await getContext().redis.pExpire(key, this.entity.TTL);
		}

		return this.decodeOrEvict(key, raw);
	}

	// A decode failure here (most commonly `RecipeSchemaMismatchError` from a `versioned` recipe, but any
	// throw from `decode()` is treated the same way) means whatever's stored under `key` doesn't match what
	// this entity can read back -- e.g. leftover bytes from a since-changed recipe shape. This is just a
	// cache: the source of truth lives elsewhere, so the safe, simple response is to evict the bad entry and
	// report a miss rather than let the error propagate to the caller. Still logged (rather than swallowed
	// outright) since a decode failure that isn't just schema drift -- a real bug in a recipe, say -- would
	// otherwise silently degrade to permanent cache misses with no visibility at all.
	private async decodeOrEvict(key: string, raw: Buffer): Promise<ValueType | null> {
		try {
			return this.entity.recipe.decode(raw);
		} catch (error) {
			getContext().logger.warn({ err: error, key }, 'failed to decode cached value, evicting');
			await getContext().redis.del([key]);
			return null;
		}
	}

	public async set(id: KeyType, value: ValueType): Promise<void> {
		const key = this.entity.makeKey(id);
		if (this.entity.storeOld && (await getContext().redis.exists(key))) {
			await getContext().redis.rename(key, `old:${key}`);
			if (this.entity.TTL) {
				await getContext().redis.pExpire(`old:${key}`, this.entity.TTL);
			}
		}

		const raw = this.entity.recipe.encode(value);
		if (this.entity.TTL) {
			await getContext().redis.set(key, raw, { expiration: { type: 'PX', value: this.entity.TTL } });
		} else {
			await getContext().redis.set(key, raw);
		}
	}

	public async delete(id: KeyType) {
		const key = this.entity.makeKey(id);
		await getContext().redis.del([key, `old:${key}`]);
	}
}
