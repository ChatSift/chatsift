import { kLogger, kRedis } from '@automoderator/injection';
import { getCreationData } from '@cordis/util';
import type { APIMessage, Snowflake } from 'discord-api-types/v9';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';

@singleton()
export class AntispamRunner {
  public constructor(
    @inject(kLogger) public readonly logger: Logger,
    @inject(kRedis) public readonly redis: Redis
  ) {}

  public async run(message: APIMessage, amount: number, time: number): Promise<Snowflake[]> {
    const key = `antispam_${message.guild_id!}_${message.author.id}`;

    await this.redis.zadd(key, getCreationData(message.id).createdTimestamp, message.id);
    await this.redis.expire(key, time);

    const messages = await this.redis.zrangebyscore(key, Date.now() - (time * 1000), Date.now());

    if (messages.length >= amount) {
      await this.redis.del(key);
      return messages;
    }

    return [];
  }
}
