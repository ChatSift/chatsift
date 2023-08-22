import type { Cache } from '@automoderator/core';
import { GuildCache, globalContainer } from '@automoderator/core';
import { injectable } from 'inversify';

type CacheConstructor = new () => Cache<unknown>;

@injectable()
export class ProxyCache {
	private readonly cacheConstructorsMap: Record<string, CacheConstructor> = {
		'/guilds/:id': GuildCache,
	};

	private readonly idResolversMap: Record<string, (parameters: string[]) => string> = {
		'/guilds/:id': (parameters) => parameters[0]!,
	};

	public async fetch(route: string): Promise<unknown> {
		const [normalized, parameters] = this.normalizeRoute(route);

		const cacheConstructor = this.cacheConstructorsMap[normalized];
		const idResolver = this.idResolversMap[normalized];

		if (cacheConstructor && idResolver) {
			const cache = globalContainer.get<Cache<unknown>>(cacheConstructor);
			return cache.get(idResolver(parameters));
		}

		return null;
	}

	public async cache(route: string, data: unknown): Promise<void> {
		const [normalized, parameters] = this.normalizeRoute(route);

		const cacheConstructor = this.cacheConstructorsMap[normalized];
		const idResolver = this.idResolversMap[normalized];

		if (cacheConstructor && idResolver) {
			const cache = globalContainer.get<Cache<unknown>>(cacheConstructor);
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
