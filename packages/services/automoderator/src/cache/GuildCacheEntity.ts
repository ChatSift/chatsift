import type { ICacheEntity } from '@chatsift/service-core';
import { createRecipe, DataType } from 'bin-rw';
import { injectable } from 'inversify';

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
}
