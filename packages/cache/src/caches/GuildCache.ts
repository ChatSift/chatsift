import { singleton } from 'tsyringe';
import { Reader } from '../data/Reader.js';
import { Writer } from '../data/Writer.js';
import type { ITransformer } from './Cache.js';
import { Cache } from './Cache.js';

export interface CachedGuild {
	icon: string | null;
	id: string;
	name: string;
	owner_id: string;
}

@singleton()
export class GuildCache extends Cache<CachedGuild> {
	protected readonly transformer: ITransformer<CachedGuild> = {
		toBuffer: (guild) => {
			const writer = new Writer(200).u64(guild.id).string(guild.icon).string(guild.name).u64(guild.owner_id);

			return writer.dumpTrimmed();
		},
		toJSON: (data) => {
			const reader = new Reader(data);

			const decoded: CachedGuild = {
				id: reader.u64()!.toString(),
				icon: reader.string(),
				name: reader.string()!,
				owner_id: reader.u64()!.toString(),
			};

			return decoded;
		},
	};

	protected readonly TTL = 60_000;

	protected makeKey(id: string): string {
		return `guild:${id}`;
	}
}
