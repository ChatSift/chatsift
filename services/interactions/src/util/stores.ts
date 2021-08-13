import { kRedis } from '@automoderator/injection';
import { RedisStore } from '@cordis/redis-store';
import { inject, singleton } from 'tsyringe';
import type { Redis } from 'ioredis';
import type { Snowflake } from 'discord-api-types/v9';

export interface RaidCleanupMember {
  id: Snowflake;
  tag: string;
}

@singleton()
export class RaidCleanupMembersStore extends RedisStore<RaidCleanupMember[]> {
  public constructor(@inject(kRedis) redis: Redis) {
    super({
      redis,
      hash: 'raid_cleanup_members',
      encode: value => JSON.stringify(value),
      decode: (value: string) => JSON.parse(value)
    });
  }
}
