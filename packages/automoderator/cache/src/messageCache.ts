import { kRedis } from '@automoderator/injection';
import { singleton, inject } from 'tsyringe';
import { RedisStore } from '@cordis/redis-store';
import type { Redis } from 'ioredis';
import type { APIMessage } from 'discord-api-types/v9';

@singleton()
export class MessageCache {
	private readonly _maxSizePerChannel = 5000;

	private readonly _store = new RedisStore<APIMessage>({
		hash: 'messages_cache',
		redis: this.redis,
		encode: (message) => JSON.stringify(message),
		decode: (message: string) => JSON.parse(message) as APIMessage,
	});

	public constructor(@inject(kRedis) public readonly redis: Redis) {}

	public async has(message: APIMessage): Promise<boolean> {
		return Boolean(await this._store.get(message.id));
	}

	public async getChannelMessages(id: string): Promise<Map<string, APIMessage> | undefined> {
		const key = `messages_cache_${id}_list`;
		const size = await this.redis.llen(key);

		if (!size) {
			return;
		}

		const ids = await this.redis.lrange(key, 0, size);
		const promises: Promise<APIMessage | null>[] = [];

		for (const id of ids) {
			promises.push(
				this._store
					.get(id)
					.then((m) => m ?? null)
					.catch(() => null),
			);
		}

		const map = new Map<string, APIMessage>();
		const messages = await Promise.all(promises);

		for (let i = 0; i < ids.length; i++) {
			const message = messages[i];
			if (message) {
				map.set(ids[i]!, message);
			}
		}

		return map;
	}

	public get(id: string): Promise<APIMessage | undefined> {
		return this._store.get(id);
	}

	public async add(message: APIMessage): Promise<APIMessage> {
		const key = `messages_cache_${message.channel_id}_list`;

		if (!(await this.has(message))) {
			const size = await this.redis.llen(key).then((len) => len + 1);
			if (size > this._maxSizePerChannel) {
				const popped = await this.redis.lpop(key, size - this._maxSizePerChannel);
				for (const pop of popped) {
					void this._store.delete(pop);
				}
			}

			await this.redis.rpush(key, message.id);
		}

		await this._store.set(message.id, message);

		return message;
	}

	public delete(id: string): Promise<boolean> {
		return this._store.delete(id);
	}
}
