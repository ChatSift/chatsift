import type { API } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { beforeEach, expect, test, vi } from 'vitest';

const entries = new Map<string, unknown>();
const strings = new Map<string, string>();
const warn = vi.fn();
const debug = vi.fn();

// `RedisStore` is stubbed rather than driven through a fake redis client: this module's own contract is what
// is under test (which lookups reach Discord, and what each Discord answer turns into), not bin-rw's encoding,
// which `backend-core` covers where the recipe lives.
vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({
		logger: { debug, warn },
		redis: {
			async get(key: string) {
				return strings.get(key) ?? null;
			},
			async set(key: string, value: string) {
				strings.set(key, value);
				return 'OK';
			},
		},
	}),
	RedisStore: class {
		public async get(id: string): Promise<unknown> {
			return entries.get(id) ?? null;
		}

		public async set(id: string, value: unknown): Promise<void> {
			entries.set(id, value);
		}

		public async delete(id: string): Promise<void> {
			entries.delete(id);
		}
	},
}));

vi.mock('../selfId.js', () => ({ getSelfId: async () => '999888777666555444' }));

const CHANNEL_ID = '1546741477307064341';
const PARENT_ID = '1544662921001304095';

function discordError(status: 403 | 404): DiscordAPIError {
	return new DiscordAPIError(
		{ code: status === 403 ? 50_001 : 10_003, message: 'nope' },
		status === 403 ? 50_001 : 10_003,
		status,
		'GET',
		`https://discord.com/api/v10/channels/${CHANNEL_ID}`,
		{},
	);
}

function fakeApi(get: (channelId: string) => Promise<unknown>): API {
	return { channels: { get } } as unknown as API;
}

// The module keeps its in-flight map at module scope, so each test gets a fresh import for the same reason
// `sessions.test.ts` does.
async function freshModule() {
	vi.resetModules();
	return import('../channels.js');
}

beforeEach(() => {
	entries.clear();
	strings.clear();
	warn.mockClear();
	debug.mockClear();
});

test('a miss asks Discord once and every later read is free', async () => {
	const { fetchChannel } = await freshModule();
	const get = vi.fn(async () => ({ id: CHANNEL_ID, parent_id: PARENT_ID, thread_metadata: { archived: true } }));
	const api = fakeApi(get);

	const first = await fetchChannel(api, CHANNEL_ID);
	expect(first).toStrictEqual({ channel: { archived: true, id: CHANNEL_ID, parentId: PARENT_ID }, state: 'ok' });

	const second = await fetchChannel(api, CHANNEL_ID);
	expect(second).toStrictEqual(first);
	expect(get).toHaveBeenCalledTimes(1);
});

test('concurrent misses for the same channel share one request', async () => {
	const { fetchChannel } = await freshModule();
	const get = vi.fn(async () => ({ id: CHANNEL_ID, parent_id: null }));
	const api = fakeApi(get);

	await Promise.all([fetchChannel(api, CHANNEL_ID), fetchChannel(api, CHANNEL_ID), fetchChannel(api, CHANNEL_ID)]);

	expect(get).toHaveBeenCalledTimes(1);
});

test('a channel that is not a thread reports `archived` as null rather than false', async () => {
	const { fetchChannel } = await freshModule();
	const api = fakeApi(async () => ({ id: CHANNEL_ID, parent_id: PARENT_ID }));

	const lookup = await fetchChannel(api, CHANNEL_ID);

	expect(lookup.channel?.archived).toBeNull();
});

// The distinction this cache has to preserve: modmail leaves a ticket open on 403 and closes it on 404, so
// collapsing the two would close tickets over a revoked permission.
test('403 and 404 are cached separately and stay distinguishable', async () => {
	for (const [status, state] of [
		[403, 'forbidden'],
		[404, 'missing'],
	] as const) {
		entries.clear();
		strings.clear();

		const { fetchChannel } = await freshModule();
		const get = vi.fn(async () => {
			throw discordError(status);
		});
		const api = fakeApi(get);

		expect(await fetchChannel(api, CHANNEL_ID)).toStrictEqual({ channel: null, state });
		// Served from the negative entry the first call wrote, rather than asking again.
		expect(await fetchChannel(api, CHANNEL_ID)).toStrictEqual({ channel: null, state });
		expect(get).toHaveBeenCalledTimes(1);
	}
});

test('anything other than a 403/404 propagates instead of being cached as gone', async () => {
	const { fetchChannel } = await freshModule();
	const api = fakeApi(async () => {
		throw new Error('discord is down');
	});

	await expect(fetchChannel(api, CHANNEL_ID)).rejects.toThrow('discord is down');
	expect(entries.size).toBe(0);
	expect(strings.size).toBe(0);
});

test('an entry past maxAge is served immediately and refreshed in the background', async () => {
	const { fetchChannel } = await freshModule();
	let archived = true;
	const get = vi.fn(async () => ({ id: CHANNEL_ID, parent_id: PARENT_ID, thread_metadata: { archived } }));
	const api = fakeApi(get);

	await fetchChannel(api, CHANNEL_ID);
	archived = false;

	// `maxAge: 0` is past for any entry however it was jittered, so this is the stale branch without having to
	// move the clock.
	const stale = await fetchChannel(api, CHANNEL_ID, { maxAge: 0 });
	expect(stale.channel?.archived).toBe(true);

	await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
	expect((await fetchChannel(api, CHANNEL_ID)).channel?.archived).toBe(false);
});

test('a fresh entry is not refreshed', async () => {
	const { fetchChannel } = await freshModule();
	const get = vi.fn(async () => ({ id: CHANNEL_ID, parent_id: PARENT_ID, thread_metadata: { archived: false } }));
	const api = fakeApi(get);

	await fetchChannel(api, CHANNEL_ID);
	await fetchChannel(api, CHANNEL_ID, { maxAge: 60 * 60 * 1_000 });

	expect(get).toHaveBeenCalledTimes(1);
});

test('priming answers a later read without any request', async () => {
	const { fetchChannel, primeChannelCache } = await freshModule();
	const get = vi.fn(async () => {
		throw new Error('should not be reached');
	});

	primeChannelCache({ id: CHANNEL_ID, parent_id: PARENT_ID, thread_metadata: { archived: false } });
	await vi.waitFor(() => expect(entries.has(CHANNEL_ID)).toBe(true));

	expect(await fetchChannel(fakeApi(get), CHANNEL_ID)).toStrictEqual({
		channel: { archived: false, id: CHANNEL_ID, parentId: PARENT_ID },
		state: 'ok',
	});
	expect(get).not.toHaveBeenCalled();
});

test('forgetting a channel sends the next read back to Discord', async () => {
	const { fetchChannel, forgetChannel } = await freshModule();
	const get = vi.fn(async () => ({ id: CHANNEL_ID, parent_id: PARENT_ID }));
	const api = fakeApi(get);

	await fetchChannel(api, CHANNEL_ID);
	forgetChannel(CHANNEL_ID);
	await vi.waitFor(() => expect(entries.has(CHANNEL_ID)).toBe(false));

	await fetchChannel(api, CHANNEL_ID);
	expect(get).toHaveBeenCalledTimes(2);
});

test('an id that is not a snowflake never reaches redis', async () => {
	const { fetchChannel } = await freshModule();
	const api = fakeApi(async () => ({ id: 'nonsense', parent_id: null }));

	await fetchChannel(api, 'nonsense');

	expect(entries.size).toBe(0);
	expect(strings.size).toBe(0);
});
