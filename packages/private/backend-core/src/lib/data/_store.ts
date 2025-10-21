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

		return this.entity.recipe.decode(raw);
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

		return this.entity.recipe.decode(raw);
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
