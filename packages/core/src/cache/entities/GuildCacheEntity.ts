import type { Buffer } from 'node:buffer';
import { createRecipe, DataType, Reader, Writer } from 'bin-rw';
import { injectable } from 'inversify';
import type { ICacheEntity } from './ICacheEntity';

export interface CachedGuild {
	icon: string | null;
	id: string;
	name: string;
	owner_id: string;
}

@injectable()
export class GuildCacheEntity implements ICacheEntity<CachedGuild> {
	public readonly TTL = 60_000;

	public readonly recipe = createRecipe(
		{
			icon: DataType.String,
			id: DataType.String,
			name: DataType.String,
			owner_id: DataType.String,
		},
		200,
	);

	public makeKey(id: string): string {
		return `guild:${id}`;
	}

	public toBuffer(guild: CachedGuild): Buffer {
		return new Writer(200).u64(guild.id).string(guild.icon).string(guild.name).u64(guild.owner_id).dump();
	}

	public toJSON(data: Buffer): CachedGuild {
		const reader = new Reader(data);

		const decoded: CachedGuild = {
			id: reader.u64()!.toString(),
			icon: reader.string(),
			name: reader.string()!,
			owner_id: reader.u64()!.toString(),
		};

		return decoded;
	}
}
