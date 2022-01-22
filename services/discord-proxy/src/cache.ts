interface RecursiveRecord<T> {
	[key: string]: RecursiveRecord<T> | T;
}

const CACHE_TIMES: RecursiveRecord<number> = {
	guilds: {
		id: {
			// 30 seconds - we don't currently actively need fresh guild data - we mostly fetch guilds for permissions
			default: 30000,
			// Bit of a compromise - we do somewhat need active channel data to properly handle ignored channels
			channels: 15000,
			// Also a comprmise - this is used for self assignables besides for permissions
			roles: 15000,
			members: {
				id: 15000,
			},
		},
	},
};

interface CacheData {
	cache?: boolean;
	cacheTime?: number;
}

export function resolveCacheOptions(path: string, method: string): CacheData {
	if (method !== 'get') {
		return {};
	}

	const routes = path
		.substr(1)
		.split('/')
		.map((route) => (/\d{17,19}/g.test(route) ? 'id' : route));

	let cacheTime: number;
	let layer = CACHE_TIMES;

	for (const route of routes) {
		const indexed = layer[route];
		if (!indexed) {
			return {
				cache: false,
			};
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

	return {
		cache: true,
		cacheTime: cacheTime!,
	};
}
