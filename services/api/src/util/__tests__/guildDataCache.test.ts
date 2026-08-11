import { DiscordAPIError } from '@discordjs/rest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { store, redis, fakeResolveGuildAPI } = vi.hoisted(() => ({
	// Stand-in for the redis-backed `RedisStore` -- the encoding is bin-rw's problem, not this module's;
	// what's under test is the read/write/delete choreography around it.
	store: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
	// The negative cache deliberately bypasses `store` (it needs its own, much shorter TTL), so it's a raw
	// redis key and has to be asserted separately.
	redis: { set: vi.fn(), del: vi.fn(), exists: vi.fn() },
	fakeResolveGuildAPI: vi.fn(),
}));

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({ redis }),
	RedisStore: class {
		public readonly get = store.get;

		public readonly set = store.set;

		public readonly delete = store.delete;
	},
}));

vi.mock('../discordAPI.js', () => ({ resolveGuildAPI: fakeResolveGuildAPI }));

const { createCachedGuildFetcher } = await import('../guildDataCache.js');

const GUILD = '1425493115053019319';
const KEY = `AMA:${GUILD}:public`;
const NEGATIVE_KEY = `guilddata:channels:negative:${KEY}`;

function discordError(status: number): DiscordAPIError {
	return new DiscordAPIError({ code: 50_001, message: 'no access' }, status, status, 'GET', '', {});
}

/**
 * A deferred promise, so a test can hold a fetch open and land a second call on it while the first is still
 * in flight -- which is the only way to exercise the in-flight de-duplication at all.
 */
function deferred<TValue>() {
	let settleWith!: (value: TValue) => void;
	let failWith!: (error: unknown) => void;
	const promise = new Promise<TValue>((resolve, reject) => {
		settleWith = resolve;
		failWith = reject;
	});

	return { promise, resolve: settleWith, reject: failWith };
}

beforeEach(() => {
	fakeResolveGuildAPI.mockReturnValue({ api: {}, cacheKey: 'public' });
	store.get.mockResolvedValue(null);
	store.set.mockResolvedValue(undefined);
	store.delete.mockResolvedValue(undefined);
	redis.exists.mockResolvedValue(0);
	redis.set.mockResolvedValue('OK');
	redis.del.mockResolvedValue(1);
});

afterEach(() => {
	vi.clearAllMocks();
});

test('a cache hit answers without going to Discord', async () => {
	store.get.mockResolvedValue({ items: [{ id: '1' }] });
	const fetchRaw = vi.fn();
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	await expect(fetcher.fetch(GUILD, 'AMA')).resolves.toStrictEqual([{ id: '1' }]);
	expect(fetchRaw).not.toHaveBeenCalled();
});

test('a miss fetches, caches, and clears any stale negative entry', async () => {
	const fetchRaw = vi.fn().mockResolvedValue([{ id: '1' }]);
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	await expect(fetcher.fetch(GUILD, 'AMA')).resolves.toStrictEqual([{ id: '1' }]);
	expect(store.set).toHaveBeenCalledWith(KEY, { items: [{ id: '1' }] });
	// Guild access can come back (bot reinstalled) well before a negative entry would expire on its own.
	expect(redis.del).toHaveBeenCalledWith(NEGATIVE_KEY);
});

// The cache is partitioned per (botId, guildId, instance): the same guild queried through a different bot,
// or through a custom instance's application, must not be answered by another's entry (#216).
test('the cache key spans bot, guild and instance', async () => {
	const fetchRaw = vi.fn().mockResolvedValue([]);
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	await fetcher.fetch(GUILD, 'MODMAIL');
	expect(store.get).toHaveBeenCalledWith(`MODMAIL:${GUILD}:public`);

	fakeResolveGuildAPI.mockReturnValue({ api: {}, cacheKey: 'partner-instance' });
	await fetcher.fetch(GUILD, 'MODMAIL');
	expect(store.get).toHaveBeenLastCalledWith(`MODMAIL:${GUILD}:partner-instance`);
});

// A guild the bot was removed from keeps getting hit (a still-valid dashboard session, say) -- without a
// negative entry that hammers Discord's REST bucket on every single request.
test('a 403 or 404 becomes null and writes a short-lived negative entry', async () => {
	for (const status of [403, 404]) {
		const fetchRaw = vi.fn().mockRejectedValue(discordError(status));
		const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

		await expect(fetcher.fetch(GUILD, 'AMA')).resolves.toBeNull();
		// 30s, deliberately far shorter than the 5-minute positive TTL, so a reinstall recovers quickly.
		expect(redis.set).toHaveBeenCalledWith(NEGATIVE_KEY, '1', { expiration: { type: 'PX', value: 30_000 } });
		expect(store.set).not.toHaveBeenCalled();
		vi.clearAllMocks();
		fakeResolveGuildAPI.mockReturnValue({ api: {}, cacheKey: 'public' });
		store.get.mockResolvedValue(null);
		redis.exists.mockResolvedValue(0);
	}
});

test('a cached negative entry answers null without fetching', async () => {
	redis.exists.mockResolvedValue(1);
	const fetchRaw = vi.fn();
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	await expect(fetcher.fetch(GUILD, 'AMA')).resolves.toBeNull();
	expect(fetchRaw).not.toHaveBeenCalled();
});

// A rate limit or a 5xx says nothing about whether the bot has access, so it must not be cached as a
// negative -- it just propagates.
test('any other failure propagates and caches nothing', async () => {
	const fetchRaw = vi.fn().mockRejectedValue(discordError(500));
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	await expect(fetcher.fetch(GUILD, 'AMA')).rejects.toBeInstanceOf(DiscordAPIError);
	expect(redis.set).not.toHaveBeenCalled();
	expect(store.set).not.toHaveBeenCalled();
});

test('a forced refresh skips both caches and fetches anyway', async () => {
	store.get.mockResolvedValue({ items: [{ id: 'stale' }] });
	redis.exists.mockResolvedValue(1);
	const fetchRaw = vi.fn().mockResolvedValue([{ id: 'fresh' }]);
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	await expect(fetcher.fetch(GUILD, 'AMA', true)).resolves.toStrictEqual([{ id: 'fresh' }]);
	expect(store.get).not.toHaveBeenCalled();
	expect(redis.exists).not.toHaveBeenCalled();
});

// Without this, a stale entry would keep answering reads until its full TTL expired even though the forced
// refresh just proved the bot no longer has access.
test('a forced refresh that 403s drops the stale entry', async () => {
	const fetchRaw = vi.fn().mockRejectedValue(discordError(403));
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	await expect(fetcher.fetch(GUILD, 'AMA', true)).resolves.toBeNull();
	expect(store.delete).toHaveBeenCalledWith(KEY);
});

test('an unforced 403 leaves any existing entry alone', async () => {
	const fetchRaw = vi.fn().mockRejectedValue(discordError(403));
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	await expect(fetcher.fetch(GUILD, 'AMA')).resolves.toBeNull();
	expect(store.delete).not.toHaveBeenCalled();
});

// Overlapping requests for the same key (a dashboard page load fires several at once) must share one fetch
// rather than race their own cache mutations against each other.
test('overlapping calls share a single fetch', async () => {
	const gate = deferred<{ id: string }[]>();
	const fetchRaw = vi.fn().mockReturnValue(gate.promise);
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	const first = fetcher.fetch(GUILD, 'AMA');
	const second = fetcher.fetch(GUILD, 'AMA');
	gate.resolve([{ id: '1' }]);

	await expect(Promise.all([first, second])).resolves.toStrictEqual([[{ id: '1' }], [{ id: '1' }]]);
	expect(fetchRaw).toHaveBeenCalledOnce();
});

test('the in-flight entry is released so a later call can fetch again', async () => {
	const fetchRaw = vi.fn().mockResolvedValue([]);
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	await fetcher.fetch(GUILD, 'AMA');
	await fetcher.fetch(GUILD, 'AMA');

	expect(fetchRaw).toHaveBeenCalledTimes(2);
});

// The `forceBox` is a mutable box rather than a boolean captured up front for exactly this case: a forced
// caller coalescing onto an already-running *unforced* fetch still gets the 403-clears-cache treatment it
// explicitly asked for, instead of silently inheriting the unforced fetch's behavior.
test('a forced call coalescing onto an unforced one still clears the stale entry on 403', async () => {
	const gate = deferred<unknown[]>();
	const fetchRaw = vi.fn().mockReturnValue(gate.promise);
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	const unforced = fetcher.fetch(GUILD, 'AMA');
	const forced = fetcher.fetch(GUILD, 'AMA', true);
	gate.reject(discordError(403));

	await expect(Promise.all([unforced, forced])).resolves.toStrictEqual([null, null]);
	expect(fetchRaw).toHaveBeenCalledOnce();
	expect(store.delete).toHaveBeenCalledWith(KEY);
});

// The inverse: nothing about a *later* unforced caller should be able to downgrade an in-flight forced fetch.
test('an unforced call coalescing onto a forced one keeps the forced behavior', async () => {
	const gate = deferred<unknown[]>();
	const fetchRaw = vi.fn().mockReturnValue(gate.promise);
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	const forced = fetcher.fetch(GUILD, 'AMA', true);
	const unforced = fetcher.fetch(GUILD, 'AMA');
	gate.reject(discordError(404));

	await expect(Promise.all([forced, unforced])).resolves.toStrictEqual([null, null]);
	expect(store.delete).toHaveBeenCalledWith(KEY);
});

test('different keys do not share an in-flight fetch', async () => {
	const fetchRaw = vi.fn().mockResolvedValue([]);
	const fetcher = createCachedGuildFetcher('channels', {} as never, fetchRaw);

	await Promise.all([fetcher.fetch(GUILD, 'AMA'), fetcher.fetch(GUILD, 'MODMAIL')]);

	expect(fetchRaw).toHaveBeenCalledTimes(2);
});
