import { setTimeout } from 'node:timers';
import type { RouteLike } from '@discordjs/rest';

type RecursiveRecord<T> = {
	[key: string]: RecursiveRecord<T> | T;
};

const CACHE_TIMES: RecursiveRecord<number> = {
	guilds: {
		id: {
			// We don't currently actively need fresh guild data - we mostly fetch guilds for permissions
			default: 60000,
			// Bit of a compromise - we do somewhat need active channel data to properly handle ignored channels
			channels: 15000,
			// Also a comprmise - this is used for self assignables besides for permissions
			roles: 20000,
			members: {
				id: 15000,
			},
		},
	},
};

export function resolveCacheTime(path: RouteLike): number | null {
	const routes = path
		.substring(1)
		.split('/')
		.map((route) => (/\d{17,19}/g.test(route) ? 'id' : route));

	let cacheTime: number;
	let layer = CACHE_TIMES;

	for (const route of routes) {
		const indexed = layer[route];
		if (!indexed) {
			return null;
		}

		if (typeof indexed === 'number') {
			cacheTime = indexed;
			break;
		}

		if ('default' in indexed) {
			cacheTime = indexed.default as number;
		}

		layer = indexed;
	}

	return cacheTime!;
}

const CACHE = new Map<RouteLike, unknown>();
const TIMEOUTS = new Map<RouteLike, NodeJS.Timeout>();

export function fetchCache(path: RouteLike): unknown {
	const cacheTime = resolveCacheTime(path);
	if (CACHE.has(path) && cacheTime) {
		const cached = CACHE.get(path);
		const timeout = TIMEOUTS.get(path);
		timeout?.refresh();
		return cached;
	}
}

export function cache(path: RouteLike, data: unknown) {
	const cacheTime = resolveCacheTime(path);
	if (cacheTime) {
		CACHE.set(path, data);
		TIMEOUTS.set(
			path,
			setTimeout(() => CACHE.delete(path), cacheTime),
		);
	}
}
