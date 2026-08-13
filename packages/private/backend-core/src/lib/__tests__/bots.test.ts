import { Buffer } from 'node:buffer';
import { beforeEach, expect, test, vi } from 'vitest';
import { dropGuildList, publishGuildList, readGuildList } from '../data/bots.js';

const strings = new Map<string, Buffer>();
const sets = new Map<string, Set<string>>();
const error = vi.fn();

// The real client is built `.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })`, so `sMembers` hands back
// Buffers rather than strings -- this fake does the same, since a reader that assumed strings would pass a test
// against a naive fake and then silently match nothing in production.
vi.mock('../context.js', () => ({
	getContext: () => ({
		logger: { error },
		redis: {
			async get(key: string) {
				return strings.get(key) ?? null;
			},
			async set(key: string, value: Buffer) {
				strings.set(key, value);
			},
			async del(keys: string[]) {
				for (const key of keys) {
					strings.delete(key);
				}
			},
			async exists(key: string) {
				return strings.has(key) ? 1 : 0;
			},
			async pExpire() {},
			async sAdd(key: string, member: string) {
				const set = sets.get(key) ?? new Set<string>();
				set.add(member);
				sets.set(key, set);
			},
			async sMembers(key: string) {
				return [...(sets.get(key) ?? [])].map((member) => Buffer.from(member));
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

/**
 * Simulates a replica whose entry has aged out while its index membership is still listed.
 */
function expireEntry(id: string, replicaIndex: number): void {
	strings.delete(`guilds:${id}:${replicaIndex}`);
}

beforeEach(() => {
	strings.clear();
	sets.clear();
	error.mockReset();
});

test('reads back what a single replica published', async () => {
	await publishGuildList('AMA', 0, ['1', '2']);

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1', '2']);
});

test('unions across replicas rather than letting the last writer win', async () => {
	// The whole point of the per-replica split: sharded horizontally, each replica only ever sees GUILD_CREATE
	// for its own shards, so neither of these is the complete set on its own.
	await publishGuildList('AMA', 0, ['1', '2']);
	await publishGuildList('AMA', 1, ['3', '4']);

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1', '2', '3', '4']);
});

test('de-duplicates a guild claimed by two replicas', async () => {
	await publishGuildList('AMA', 0, ['1', '2']);
	await publishGuildList('AMA', 1, ['2', '3']);

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1', '2', '3']);
});

test('keeps bots, and custom instances of one bot, in separate lists', async () => {
	await publishGuildList('AMA', 0, ['1']);
	await publishGuildList('MODMAIL', 0, ['2']);
	await publishGuildList('MODMAIL#nascar', 0, ['3']);

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1']);
	await expect(readGuildList('MODMAIL')).resolves.toStrictEqual(['2']);
	await expect(readGuildList('MODMAIL#nascar')).resolves.toStrictEqual(['3']);
});

test('is empty for a bot nothing has published for', async () => {
	await expect(readGuildList('SOCIAL')).resolves.toStrictEqual([]);
});

test('drops an expired replica from the union and prunes its index membership', async () => {
	await publishGuildList('AMA', 0, ['1']);
	await publishGuildList('AMA', 1, ['2']);
	expireEntry('AMA', 1);

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1']);
	// Pruned rather than left behind, so a replica that goes away for good doesn't grow the set forever.
	expect([...(sets.get('guildsreplicas:AMA') ?? [])]).toStrictEqual(['0']);
});

test('a released replica stops counting immediately', async () => {
	await publishGuildList('AMA', 0, ['1']);
	await publishGuildList('AMA', 1, ['2']);

	await dropGuildList('AMA', 1);

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1']);
});

test('republishing replaces that replica’s guilds rather than accumulating them', async () => {
	await publishGuildList('AMA', 0, ['1', '2']);
	await publishGuildList('AMA', 0, ['2']);

	// A guild the bot was removed from has to actually disappear -- the 10s republish is a full snapshot of
	// that replica's set, not a delta.
	await expect(readGuildList('AMA')).resolves.toStrictEqual(['2']);
});
