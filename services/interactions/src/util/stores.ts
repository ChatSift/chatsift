import { kRedis } from '@automoderator/injection';
import { RedisStore } from '@cordis/redis-store';
import { inject, singleton } from 'tsyringe';
import type { Redis } from 'ioredis';

@singleton()
export class RaidCleanupMembersStore extends RedisStore<string[]> {
  public constructor(@inject(kRedis) redis: Redis) {
    super({
      redis,
      hash: 'raid_cleanup_members',
      encode: value => value.join(','),
      decode: (value: string) => value.split(',')
    });
  }
}
