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
    encode: message => JSON.stringify(message),
    decode: message => JSON.parse(message)
  });

  public constructor(@inject(kRedis) public readonly redis: Redis) {}

  public async has(message: APIMessage): Promise<boolean> {
    return Boolean(await this._store.get(message.id));
  }

  public get(id: string): Promise<APIMessage | undefined> {
    return this._store.get(id);
  }

  public async add(message: APIMessage): Promise<APIMessage> {
    if (await this.has(message)) {
      return message;
    }

    const key = `messages_cache_${message.channel_id}_list`;

    const size = await this.redis.llen(key).then(len => len + 1);
    if (size > this._maxSizePerChannel) {
      const popped = await this.redis.lpop(key, size - this._maxSizePerChannel);
      for (const pop of popped) {
        void this._store.delete(pop);
      }
    }

    await this.redis.rpush(key, message.id);
    await this._store.set(message.id, message);

    return message;
  }

  public delete(id: string): Promise<boolean> {
    return this._store.delete(id);
  }
}
