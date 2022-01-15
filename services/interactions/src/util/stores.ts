/* istanbul ignore file */
import { kRedis } from '@automoderator/injection';
import { RedisStore } from '@cordis/redis-store';
import { inject, singleton } from 'tsyringe';
import type { Redis } from 'ioredis';
import type { Snowflake } from 'discord-api-types/v9';

export interface RaidCleanupMember {
	id: Snowflake;
	tag: string;
}

export interface RaidCleanupData {
	ban: boolean;
	members: RaidCleanupMember[];
}

@singleton()
export class RaidCleanupMembersStore extends RedisStore<RaidCleanupData> {
	public constructor(@inject(kRedis) redis: Redis) {
		super({
			redis,
			hash: 'raid_cleanup_members',
			encode: (value) => JSON.stringify(value),
			decode: (value: string) => JSON.parse(value),
		});
	}
}

export interface ChannelPaginationState {
	channel?: Snowflake;
	page: number;
	maxPages: number;
}

@singleton()
export class FilterIgnoresStateStore extends RedisStore<ChannelPaginationState> {
	public constructor(@inject(kRedis) redis: Redis) {
		super({
			redis,
			hash: 'filter_ignore_state',
			encode: (value) => JSON.stringify(value),
			decode: (value: string) => JSON.parse(value),
		});
	}
}

@singleton()
export class LogIgnoresStateStore extends RedisStore<ChannelPaginationState> {
	public constructor(@inject(kRedis) redis: Redis) {
		super({
			redis,
			hash: 'log_ignores_state',
			encode: (value) => JSON.stringify(value),
			decode: (value: string) => JSON.parse(value),
		});
	}
}
