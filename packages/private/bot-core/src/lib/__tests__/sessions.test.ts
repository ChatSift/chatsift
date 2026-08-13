import type { SessionInfo } from '@discordjs/ws';
import { beforeEach, expect, test, vi } from 'vitest';
import { createSessionStore } from '../sessions.js';

const stored = new Map<string, SessionInfo>();
const getCalls: string[] = [];
const setCalls: { id: string; value: SessionInfo }[] = [];
const deleteCalls: string[] = [];
const error = vi.fn();
let failReads = false;

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({ logger: { error } }),
	RedisStore: class {
		public async get(id: string): Promise<SessionInfo | null> {
			getCalls.push(id);
			if (failReads) {
				throw new Error('redis is down');
			}

			return stored.get(id) ?? null;
		}

		public async set(id: string, value: SessionInfo): Promise<void> {
			setCalls.push({ id, value });
			stored.set(id, value);
		}

		public async delete(id: string): Promise<void> {
			deleteCalls.push(id);
			stored.delete(id);
		}
	},
}));

const session = (shardId: number, sequence: number): SessionInfo => ({
	resumeURL: 'wss://example.invalid',
	sequence,
	sessionId: `session-${shardId}`,
	shardCount: 2,
	shardId,
});

beforeEach(() => {
	stored.clear();
	getCalls.length = 0;
	setCalls.length = 0;
	deleteCalls.length = 0;
	error.mockReset();
	failReads = false;
});

test('reads redis once per shard, then serves from memory', async () => {
	// This is the property the whole write-behind design exists for: `@discordjs/ws` calls `retrieveSessionInfo`
	// on *every dispatch event*, so anything that reaches redis per call puts a round trip in front of every
	// Discord event the process handles.
	stored.set('AMA:0', session(0, 10));
	const store = createSessionStore('AMA');

	await expect(store.retrieveSessionInfo(0)).resolves.toMatchObject({ sequence: 10 });
	await store.retrieveSessionInfo(0);
	await store.retrieveSessionInfo(0);

	expect(getCalls).toStrictEqual(['AMA:0']);
});

test('does not touch redis on update until a flush', async () => {
	const store = createSessionStore('AMA');

	await store.updateSessionInfo(0, session(0, 1));
	await store.updateSessionInfo(0, session(0, 2));

	expect(setCalls).toStrictEqual([]);
});

test('flushes only the latest value per shard, not every intermediate one', async () => {
	const store = createSessionStore('AMA');

	await store.updateSessionInfo(0, session(0, 1));
	await store.updateSessionInfo(0, session(0, 2));
	await store.updateSessionInfo(0, session(0, 3));
	await store.flush();

	expect(setCalls).toHaveLength(1);
	expect(setCalls[0]).toMatchObject({ id: 'AMA:0', value: { sequence: 3 } });
});

test('serves an updated session from memory without ever reading redis', async () => {
	const store = createSessionStore('AMA');

	await store.updateSessionInfo(1, session(1, 7));

	await expect(store.retrieveSessionInfo(1)).resolves.toMatchObject({ sequence: 7 });
	expect(getCalls).toStrictEqual([]);
});

test('flushes each dirty shard separately', async () => {
	const store = createSessionStore('AMA');

	await store.updateSessionInfo(0, session(0, 1));
	await store.updateSessionInfo(1, session(1, 1));
	await store.flush();

	expect(setCalls.map((call) => call.id).sort((left, right) => left.localeCompare(right))).toStrictEqual([
		'AMA:0',
		'AMA:1',
	]);
});

test('a null update deletes the stored session instead of leaving a stale one', async () => {
	// discord.js passes null when a session is invalidated. Keeping the old entry would guarantee a failed
	// RESUME on the next boot rather than a clean IDENTIFY.
	stored.set('AMA:0', session(0, 10));
	const store = createSessionStore('AMA');

	await store.updateSessionInfo(0, null);
	await store.flush();

	expect(deleteCalls).toStrictEqual(['AMA:0']);
	await expect(store.retrieveSessionInfo(0)).resolves.toBeNull();
});

test('a second flush with nothing dirty is a no-op', async () => {
	const store = createSessionStore('AMA');

	await store.updateSessionInfo(0, session(0, 1));
	await store.flush();
	await store.flush();

	expect(setCalls).toHaveLength(1);
});

test('namespaces sessions per bot so two bots cannot collide', async () => {
	const ama = createSessionStore('AMA');
	const instance = createSessionStore('MODMAIL#nascar');

	await ama.updateSessionInfo(0, session(0, 1));
	await instance.updateSessionInfo(0, session(0, 2));
	await ama.flush();
	await instance.flush();

	expect(setCalls.map((call) => call.id)).toStrictEqual(['AMA:0', 'MODMAIL#nascar:0']);
});

test('falls back to identifying when redis cannot be read', async () => {
	// A missing session means IDENTIFY, which is the correct fallback -- a redis hiccup must never stop a shard
	// from connecting at all.
	failReads = true;
	const store = createSessionStore('AMA');

	await expect(store.retrieveSessionInfo(0)).resolves.toBeNull();
	expect(error).toHaveBeenCalledOnce();
});
