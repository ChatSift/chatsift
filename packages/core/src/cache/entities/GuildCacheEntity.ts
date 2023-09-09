import type { Buffer } from 'node:buffer';
import { injectable } from 'inversify';
import { RWFactory } from '../../binary-encoding/RWFactory.js';
import type { ICacheEntity } from './ICacheEntity';

export interface CachedGuild {
	icon: string | null;
	id: string;
	name: string;
	owner_id: string;
}

@injectable()
export class GuildCacheEntity implements ICacheEntity<CachedGuild> {
	public constructor(private readonly rwFactory: RWFactory) {}

	public readonly TTL = 60_000;

	public makeKey(id: string): string {
		return `guild:${id}`;
	}

	public toBuffer(guild: CachedGuild): Buffer {
		return this.rwFactory
			.buildWriter(200)
			.u64(guild.id)
			.string(guild.icon)
			.string(guild.name)
			.u64(guild.owner_id)
			.dumpTrimmed();
	}

	public toJSON(data: Buffer): CachedGuild {
		const reader = this.rwFactory.buildReader(data);

		const decoded: CachedGuild = {
			id: reader.u64()!.toString(),
			icon: reader.string(),
			name: reader.string()!,
			owner_id: reader.u64()!.toString(),
		};

		return decoded;
	}
}
