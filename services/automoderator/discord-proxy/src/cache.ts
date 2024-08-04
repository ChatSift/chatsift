import type { ICacheEntity } from '@automoderator/core';
import { globalContainer, CacheFactory, GuildCacheEntity } from '@automoderator/core';
import { injectable } from 'inversify';

@injectable()
export class ProxyCache {
	public constructor(private readonly cacheFactory: CacheFactory) {}

	private readonly cacheEntityTokensMap: Record<string, new () => ICacheEntity<unknown>> = {
		'/guilds/:id': GuildCacheEntity,
	};

	private readonly idResolversMap: Record<string, (parameters: string[]) => string> = {
		'/guilds/:id': (parameters) => parameters[0]!,
	};

	public async fetch(route: string): Promise<unknown> {
		const [normalized, parameters] = this.normalizeRoute(route);

		const cacheEntityToken = this.cacheEntityTokensMap[normalized];
		const idResolver = this.idResolversMap[normalized];

		if (cacheEntityToken && idResolver) {
			const cacheEntity = globalContainer.get<ICacheEntity<unknown>>(cacheEntityToken);
			const cache = this.cacheFactory.build(cacheEntity);

			return cache.get(idResolver(parameters));
		}

		return null;
	}

	public async update(route: string, data: unknown): Promise<void> {
		const [normalized, parameters] = this.normalizeRoute(route);

		const cacheEntityToken = this.cacheEntityTokensMap[normalized];
		const idResolver = this.idResolversMap[normalized];

		if (cacheEntityToken && idResolver) {
			const cacheEntity = globalContainer.get<ICacheEntity<unknown>>(cacheEntityToken);
			const cache = this.cacheFactory.build(cacheEntity);

			await cache.set(idResolver(parameters), data);
		}
	}

	private normalizeRoute(route: string): [normalized: string, parameters: string[]] {
		const normalized = route.replaceAll(/\d{17,19}/g, ':id');
		const parameters = route
			.slice(1)
			.split('/')
			.filter((component) => /\d{17,19}/.test(component));

		return [normalized, parameters];
	}
}
