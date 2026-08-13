import { Buffer } from 'node:buffer';
import { beforeEach, expect, test, vi } from 'vitest';
import {
	addGuildToList,
	dropGuildList,
	guildListExists,
	readGuildList,
	removeGuildFromList,
	resetGuildList,
	touchGuildList,
} from '../data/bots.js';

const sets = new Map<string, Set<string>>();
const expiries = new Map<string, number>();
const error = vi.fn();
let now = 1_000_000;

/**
 * Models redis expiry on the *set* keys, so a slice ageing out is a real state this fake can reach rather than
 * something only production ever sees.
 */
function live(key: string): boolean {
	const expiresAt = expiries.get(key);
	if (expiresAt !== undefined && expiresAt <= now) {
		sets.delete(key);
		expiries.delete(key);
		return false;
	}

	return sets.has(key);
}

// The real client is built `.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })`, so `sMembers` hands back
// Buffers rather than strings -- this fake does the same, since a reader that assumed strings would pass a test
// against a naive fake and then silently match nothing in production.
vi.mock('../context.js', () => ({
	getContext: () => ({
		logger: { error },
		redis: {
			async del(key: string) {
				sets.delete(key);
				expiries.delete(key);
			},
			async exists(key: string) {
				return live(key) ? 1 : 0;
			},
			async pExpire(key: string, ttl: number) {
				if (!live(key)) {
					return 0;
				}

				expiries.set(key, now + ttl);
				return 1;
			},
			async sAdd(key: string, member: string) {
				// An expired key must not be resurrected with its old members still in it.
				live(key);
				const set = sets.get(key) ?? new Set<string>();
				set.add(member);
				sets.set(key, set);
			},
			async sMembers(key: string) {
				return live(key) ? [...sets.get(key)!].map((member) => Buffer.from(member)) : [];
			},
			async sRem(key: string, members: string[]) {
				const set = sets.get(key);
				for (const member of members) {
					set?.delete(member);
				}
			},
		},
	}),
}));

function expireSlice(id: string, replicaIndex: number): void {
	sets.delete(`guilds:${id}:${replicaIndex}`);
	expiries.delete(`guilds:${id}:${replicaIndex}`);
}

beforeEach(() => {
	sets.clear();
	expiries.clear();
	error.mockReset();
	now = 1_000_000;
});

test('reads back the guilds one replica added', async () => {
	await resetGuildList('AMA', 0);
	await addGuildToList('AMA', 0, '1');
	await addGuildToList('AMA', 0, '2');

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1', '2']);
});

test('unions across replicas, deduplicating', async () => {
	await addGuildToList('AMA', 0, '1');
	await addGuildToList('AMA', 0, '2');
	await addGuildToList('AMA', 1, '2');
	await addGuildToList('AMA', 1, '3');

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1', '2', '3']);
});

test('keys are per bot, and a custom instance is its own key', async () => {
	await addGuildToList('AMA', 0, '1');
	await addGuildToList('MODMAIL', 0, '2');
	await addGuildToList('MODMAIL#nascar', 0, '3');

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1']);
	await expect(readGuildList('MODMAIL')).resolves.toStrictEqual(['2']);
	await expect(readGuildList('MODMAIL#nascar')).resolves.toStrictEqual(['3']);
});

test('a bot nothing has published for reads as empty', async () => {
	await expect(readGuildList('SOCIAL')).resolves.toStrictEqual([]);
});

test('leaving a guild removes it without touching the rest', async () => {
	await addGuildToList('AMA', 0, '1');
	await addGuildToList('AMA', 0, '2');

	await removeGuildFromList('AMA', 0, '1');

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['2']);
});

test('a crashed replica drops out of the union once its slice expires', async () => {
	await addGuildToList('AMA', 0, '1');
	await addGuildToList('AMA', 1, '2');

	expireSlice('AMA', 1);

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1']);
	// Pruned on read, so the index doesn't grow forever.
	await expect(guildListExists('AMA', 1)).resolves.toBe(false);
});

test('the set survives a graceful shutdown so the next boot can resume onto it', async () => {
	// The regression this whole shape exists for: a resumed session gets no GUILD_CREATE sweep, so if shutdown
	// destroyed the state there would be nothing left to resume onto and the bot would advertise no guilds.
	await addGuildToList('AMA', 0, '1');
	await dropGuildList('AMA', 0);

	await expect(guildListExists('AMA', 0)).resolves.toBe(true);
	// ...but it stops being counted immediately, which is what dropping the index membership is for.
	await expect(readGuildList('AMA')).resolves.toStrictEqual([]);

	// Coming back re-registers it, with the guilds intact and no re-identify needed.
	await touchGuildList('AMA', 0);
	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1']);
});

test('READY starts the slice over, RESUMED does not', async () => {
	await addGuildToList('AMA', 0, '1');
	await addGuildToList('AMA', 0, '2');

	// A fresh identify is about to re-announce everything, so stale membership must not survive into it.
	await resetGuildList('AMA', 0);

	await expect(readGuildList('AMA')).resolves.toStrictEqual([]);
});

test('the heartbeat re-arms the TTL rather than rewriting the set', async () => {
	await addGuildToList('AMA', 0, '1');

	now += 50_000;
	await expect(touchGuildList('AMA', 0)).resolves.toBe(true);

	// Without the refresh this would have aged out at now + 60s from the add.
	now += 50_000;
	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1']);
});

test('the heartbeat reports a slice that expired underneath it', async () => {
	await addGuildToList('AMA', 0, '1');
	expireSlice('AMA', 0);

	// `false` is what makes the caller force a re-identify instead of running on an empty guild list.
	await expect(touchGuildList('AMA', 0)).resolves.toBe(false);
});
