import { kRedis } from '@automoderator/injection';
import { RedisStore } from '@cordis/redis-store';
import type { APIMessage } from 'discord-api-types/v9';
// eslint-disable-next-line import/no-extraneous-dependencies, n/no-extraneous-import
import { Redis } from 'ioredis';
import { singleton, inject } from 'tsyringe';

@singleton()
export class MessageCache {
	private readonly _maxSizePerChannel = 5_000;

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

	public async getChannelMessages(channelId: string): Promise<Map<string, APIMessage> | undefined> {
		const key = `messages_cache_${channelId}_list`;
		const size = await this.redis.llen(key);

		if (!size) {
			return undefined;
		}

		const ids = await this.redis.lrange(key, 0, size);
		const promises: Promise<APIMessage | null>[] = [];

		for (const id of ids) {
			promises.push(
				this._store
					.get(id)
					// eslint-disable-next-line promise/prefer-await-to-then
					.then((message) => message ?? null)
					// eslint-disable-next-line promise/prefer-await-to-then
					.catch(() => null),
			);
		}

		const map = new Map<string, APIMessage>();
		const messages = await Promise.all(promises);

		for (const [index, id_] of ids.entries()) {
			const message = messages[index];
			if (message) {
				map.set(id_!, message);
			}
		}

		return map;
	}

	public async get(id: string): Promise<APIMessage | undefined> {
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

	// eslint-disable-next-line @typescript-eslint/promise-function-async
	public delete(id: string): Promise<boolean> {
		return this._store.delete(id);
	}
}
