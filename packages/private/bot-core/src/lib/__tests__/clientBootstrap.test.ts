import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import type { REST } from '@discordjs/rest';
import { WebSocketShardEvents } from '@discordjs/ws';
import type { WebSocketManager } from '@discordjs/ws';
import { beforeEach, expect, test, vi } from 'vitest';
import { stubBackendCoreEnv } from './testEnv.js';

const { fakeLogger, redisStore, bulkOverwrite, existingCommands } = vi.hoisted(() => ({
	fakeLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
	redisStore: new Set<string>(),
	bulkOverwrite: vi.fn(),
	existingCommands: { value: [] as unknown[] },
}));

vi.mock('@chatsift/backend-core', async (importActual) => {
	stubBackendCoreEnv();
	const actual = await importActual<typeof import('@chatsift/backend-core')>();

	return {
		...actual,
		primeUserCache: vi.fn(),
		// The guild list is exercised on its own in `backend-core`'s `bots.test.ts`; here it's stubbed so the
		// bootstrap paths can be driven in isolation. `guildListExists` must answer `true` -- a `false` sends
		// the client into `recoverLostGuildList`, which SIGTERMs the vitest process.
		guildListExists: vi.fn(async () => true),
		resetGuildList: vi.fn(),
		addGuildToList: vi.fn(),
		removeGuildFromList: vi.fn(),
		touchGuildList: vi.fn(async () => true),
		dropGuildList: vi.fn(),
		getContext: () => ({
			logger: fakeLogger,
			redis: {
				set: async (key: string) => {
					if (redisStore.has(key)) {
						return null;
					}

					redisStore.add(key);
					return 'OK';
				},
				del: async (key: string) => {
					redisStore.delete(key);
					return 1;
				},
			},
		}),
	};
});

const { createBotClient } = await import('../client.js');

// `Client` only ever reaches Discord through `rest`, so a stub that branches on the route is enough to stand
// the whole thing up without a network.
function fakeRest() {
	const get = vi.fn(async (route: string) => {
		if (route === '/oauth2/applications/@me') {
			return { id: 'app-from-rest' };
		}

		return existingCommands.value;
	});

	const rest = { get, put: bulkOverwrite, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as REST;
	return { rest, get };
}

function dispatch(gateway: EventEmitter, type: string, data: unknown) {
	gateway.emit(WebSocketShardEvents.Dispatch, { t: type, d: data }, 0);
}

beforeEach(() => {
	redisStore.clear();
	bulkOverwrite.mockReset().mockResolvedValue([]);
	fakeLogger.error.mockReset();
	existingCommands.value = [];
});

test('RESUMED bootstraps too, resolving the application id over REST', async () => {
	// The #355 regression: the session store makes a graceful restart replay as RESUMED, so a Ready-only hook
	// stops firing after the application's first boot ever and /deploy can never be re-seeded.
	const gateway = new EventEmitter();
	createBotClient({ botId: 'AMA', gateway: gateway as unknown as WebSocketManager, rest: fakeRest().rest });

	dispatch(gateway, 'RESUMED', null);
	await vi.waitFor(() => expect(bulkOverwrite).toHaveBeenCalledOnce());

	expect(bulkOverwrite.mock.calls[0]![0]).toBe('/applications/app-from-rest/commands');
});

test('READY bootstraps without a REST lookup, since it carries the application id', async () => {
	const gateway = new EventEmitter();
	const { rest, get } = fakeRest();
	createBotClient({ botId: 'AMA', gateway: gateway as unknown as WebSocketManager, rest });

	dispatch(gateway, 'READY', { application: { id: 'app-from-ready' } });
	await vi.waitFor(() => expect(bulkOverwrite).toHaveBeenCalledOnce());

	expect(bulkOverwrite.mock.calls[0]![0]).toBe('/applications/app-from-ready/commands');
	expect(get.mock.calls.map(([route]) => route)).not.toContain('/oauth2/applications/@me');
});

test('a failed bootstrap is retried by the next gateway event', async () => {
	// A flag set before the async work would suppress the retry too, so one transient 503 on the
	// application-id lookup would mean this process never seeds /deploy again however often it reconnects.
	const gateway = new EventEmitter();
	const { rest, get } = fakeRest();
	get.mockRejectedValueOnce(new Error('503 from Discord'));
	createBotClient({ botId: 'AMA', gateway: gateway as unknown as WebSocketManager, rest });

	dispatch(gateway, 'RESUMED', null);
	await vi.waitFor(() => expect(fakeLogger.error).toHaveBeenCalled());
	expect(bulkOverwrite).not.toHaveBeenCalled();

	dispatch(gateway, 'RESUMED', null);
	await vi.waitFor(() => expect(bulkOverwrite).toHaveBeenCalledOnce());
});

test('a reconnect storm bootstraps at most once per process', async () => {
	const gateway = new EventEmitter();
	createBotClient({ botId: 'AMA', gateway: gateway as unknown as WebSocketManager, rest: fakeRest().rest });

	dispatch(gateway, 'READY', { application: { id: 'app-from-ready' } });
	await vi.waitFor(() => expect(bulkOverwrite).toHaveBeenCalledOnce());

	// Every later RESUMED is a reconnect, not a fresh process -- re-running the check each time would put a
	// Discord round trip on every network blip.
	dispatch(gateway, 'RESUMED', null);
	dispatch(gateway, 'RESUMED', null);
	await new Promise((resolve) => {
		setImmediate(resolve);
	});

	expect(bulkOverwrite).toHaveBeenCalledOnce();
});
