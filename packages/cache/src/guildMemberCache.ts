import { kRedis } from '@automoderator/injection';
import { RedisStore } from '@cordis/redis-store';
import type { APIUser, APIGuildMember } from 'discord-api-types/v9';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Redis } from 'ioredis';
import { singleton, inject } from 'tsyringe';

export type CachedGuildMember = APIGuildMember & { guild_id: string; user: APIUser };

@singleton()
export class GuildMemberCache {
	private readonly _maxSizePerGuild = 3e4;

	private readonly _stores = new Map<string, RedisStore<CachedGuildMember>>();

	public constructor(@inject(kRedis) public readonly redis: Redis) {}

	private _assertStore(guild: CachedGuildMember | string): RedisStore<CachedGuildMember> {
		// eslint-disable-next-line no-param-reassign
		guild = typeof guild === 'string' ? guild : guild.guild_id;

		if (this._stores.has(guild)) {
			return this._stores.get(guild)!;
		}

		const store = new RedisStore<CachedGuildMember>({
			hash: `guild_members_cache_${guild}`,
			// @ts-expect-error - miss match
			redis: this.redis,
			encode: (member) => JSON.stringify(member),
			decode: (member: string) => JSON.parse(member) as CachedGuildMember,
		});

		this._stores.set(guild, store);
		return store;
	}

	public async has(member: CachedGuildMember): Promise<boolean> {
		const store = this._assertStore(member);
		return Boolean(await store.get(member.user.id));
	}

	// eslint-disable-next-line @typescript-eslint/promise-function-async
	public get(guildId: string, memberId: string): Promise<CachedGuildMember | undefined> {
		const store = this._assertStore(guildId);
		return store.get(memberId);
	}

	public async add(member: CachedGuildMember): Promise<CachedGuildMember> {
		const store = this._assertStore(member);

		if (!(await this.has(member))) {
			const key = `guild_members_cache_${member.guild_id}_list`;

			const size = await this.redis.llen(key).then((len) => len + 1);
			if (size > this._maxSizePerGuild) {
				const popped = await this.redis.lpop(key, size - this._maxSizePerGuild);
				if (popped) {
					for (const pop of popped) {
						void store.delete(pop);
					}
				}
			}

			await this.redis.rpush(key, member.user.id);
		}

		await store.set(member.user.id, member);

		return member;
	}

	public async delete(guildId: string, memberId: string): Promise<boolean> {
		const store = this._assertStore(guildId);
		return store.delete(memberId);
	}
}
