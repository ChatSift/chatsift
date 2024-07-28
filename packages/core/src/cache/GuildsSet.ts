import { inject, injectable } from 'inversify';
import { Redis } from 'ioredis';
import { INJECTION_TOKENS } from '../container.js';

@injectable()
export class GuildsSet {
	public constructor(@inject(INJECTION_TOKENS.redis) private readonly redis: Redis) {}

	private readonly key = 'guilds_set';

	public async has(guildId: string): Promise<boolean> {
		const has = await this.redis.sismember(this.key, guildId);
		return has === 1;
	}

	public async add(guildId: string): Promise<void> {
		await this.redis.sadd(this.key, guildId);
	}

	public async remove(guildId: string): Promise<void> {
		await this.redis.srem(this.key, guildId);
	}
}
