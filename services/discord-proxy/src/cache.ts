import type { StrippedGuild } from '@automoderator/cache';
import { GuildCache } from '@automoderator/cache';
import { container } from 'tsyringe';

function normalizeRoute(route: string): [string, string[]] {
	const normalized = route.replaceAll(/\d{17,19}/g, ':id');
	const components = normalized.slice(1).split('/');

	return [normalized, components];
}

export async function fetchCache<T>(route: string): Promise<T | null> {
	const [normalized, components] = normalizeRoute(route);
	switch (normalized) {
		case '/guilds/:id': {
			const cache = container.resolve(GuildCache);
			const [, id] = components as [string, string];

			return cache.get(id) as Promise<T | null>;
		}

		default: {
			return null;
		}
	}
}

export async function cache(route: string, data: any): Promise<void> {
	const [normalized, components] = normalizeRoute(route);
	if (normalized === '/guilds/:id') {
		const cache = container.resolve(GuildCache);
		const [, id] = components as [string, string];
		await cache.set(id, data as StrippedGuild);
	}
}
