import { SYMBOLS } from '@automoderator/common';
import Redis from 'ioredis';
import { inject, singleton } from 'tsyringe';
import type { StrippedGuild } from '../transformers/GuildTransformer';
import { guildTransformer } from '../transformers/GuildTransformer';
import { Cache } from './Cache';

@singleton()
export class GuildCache extends Cache<StrippedGuild> {
	protected readonly redis: Redis;

	protected readonly transformer = guildTransformer;

	protected readonly TTL = 60_000;

	protected makeKey(id: string): string {
		return `guild:${id}`;
	}

	public constructor(@inject(SYMBOLS.redis) redis: Redis) {
		super();
		this.redis = redis;
	}
}
