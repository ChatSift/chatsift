import { Buffer } from 'node:buffer';
import { beforeEach, expect, test, vi } from 'vitest';
import type { GuildListKey } from '../data/bots.js';
import {
	addGuildToList,
	countGuildList,
	dropGuildList,
	guildListExists,
	readGuildList,
	removeGuildFromList,
	syncShardGuildList,
	touchGuildList,
} from '../data/bots.js';

const sets = new Map<string, Set<string>>();
const strings = new Map<string, string>();
const expiries = new Map<string, number>();
const error = vi.fn();
let now = 1_000_000;

/**
 * Models redis expiry, so a slice ageing out is a real state this fake can reach rather than something only
 * production ever sees. Set and string keys share one keyspace here, as they do in redis.
 */
function live(key: string): boolean {
	const expiresAt = expiries.get(key);
	if (expiresAt !== undefined && expiresAt <= now) {
		sets.delete(key);
		strings.delete(key);
		expiries.delete(key);
		return false;
	}

	// Redis has no empty sets: a set key with no members does not exist. Modelled, because the crash loop this
	// suite regression-tests came from exactly that -- see the zero-guild tests below.
	return strings.has(key) || (sets.get(key)?.size ?? 0) > 0;
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
				strings.delete(key);
				expiries.delete(key);
			},
			async exists(key: string) {
				return live(key) ? 1 : 0;
			},
			async set(key: string, value: string, options?: { expiration?: { type: 'PX'; value: number } }) {
				strings.set(key, value);
				if (options?.expiration) {
					expiries.set(key, now + options.expiration.value);
				}

				return 'OK';
			},
			async pExpire(key: string, ttl: number) {
				if (!live(key)) {
					return 0;
				}

				expiries.set(key, now + ttl);
				return 1;
			},
			async sAdd(key: string, members: string[] | string) {
				// An expired key must not be resurrected with its old members still in it.
				live(key);
				const set = sets.get(key) ?? new Set<string>();
				// Both call shapes are real: one guild id at a time from GUILD_CREATE, or a whole shard's READY
				// payload in one go.
				for (const member of Array.isArray(members) ? members : [members]) {
					set.add(member);
				}

				sets.set(key, set);
			},
			async sCard(key: string) {
				return live(key) ? sets.get(key)!.size : 0;
			},
			async sMembers(key: string) {
				return live(key) ? [...sets.get(key)!].map((member) => Buffer.from(member)) : [];
			},
			async sRem(key: string, members: string[] | string) {
				const set = sets.get(key);
				// Both call shapes are real: a single guild id, or the batch of stale replica indices.
				for (const member of Array.isArray(members) ? members : [members]) {
					set?.delete(member);
				}
			},
		},
	}),
}));

/**
 * A shard's READY, for the tests that only need a live slice to exist. `clearable` answers `true` because a
 * single-shard bot speaks for every member of its own slice -- the multi-shard case gets its own tests below.
 */
async function ready(id: GuildListKey, replicaIndex: number, guildIds: string[] = []): Promise<void> {
	await syncShardGuildList(id, replicaIndex, guildIds, () => true);
}

function expireSlice(id: string, replicaIndex: number): void {
	for (const key of [`guilds:${id}:${replicaIndex}`, `guildslive:${id}:${replicaIndex}`]) {
		sets.delete(key);
		strings.delete(key);
		expiries.delete(key);
	}
}

beforeEach(() => {
	sets.clear();
	strings.clear();
	expiries.clear();
	error.mockReset();
	now = 1_000_000;
});

test('reads back the guilds one replica added', async () => {
	await ready('AMA', 0);
	await addGuildToList('AMA', 0, '1');
	await addGuildToList('AMA', 0, '2');

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1', '2']);
});

test('unions across replicas, deduplicating', async () => {
	await ready('AMA', 0);
	await ready('AMA', 1);
	await addGuildToList('AMA', 0, '1');
	await addGuildToList('AMA', 0, '2');
	await addGuildToList('AMA', 1, '2');
	await addGuildToList('AMA', 1, '3');

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1', '2', '3']);
});

test('keys are per bot, and a custom instance is its own key', async () => {
	await ready('AMA', 0);
	await ready('MODMAIL', 0);
	await ready('MODMAIL#nascar', 0);
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
	await ready('AMA', 0);
	await addGuildToList('AMA', 0, '1');
	await addGuildToList('AMA', 0, '2');

	await removeGuildFromList('AMA', 0, '1');

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['2']);
});

test('a crashed replica drops out of the union once its slice expires', async () => {
	await ready('AMA', 0);
	await ready('AMA', 1);
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
	await ready('AMA', 0);
	await addGuildToList('AMA', 0, '1');
	await dropGuildList('AMA', 0);

	await expect(guildListExists('AMA', 0)).resolves.toBe(true);
	// ...but it stops being counted immediately, which is what dropping the index membership is for.
	await expect(readGuildList('AMA')).resolves.toStrictEqual([]);

	// Coming back re-registers it, with the guilds intact and no re-identify needed.
	await touchGuildList('AMA', 0);
	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1']);
});

test('READY drops what its shard has since left', async () => {
	await ready('AMA', 0);
	await addGuildToList('AMA', 0, '1');
	await addGuildToList('AMA', 0, '2');

	// Kicked from '2' while the shard was offline: no GUILD_DELETE for it ever arrives, so READY's payload
	// being the whole truth for this shard is the only thing that can notice.
	await ready('AMA', 0, ['1']);

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1']);
});

test('one shard identifying leaves a sibling shard on the same replica alone', async () => {
	// The regression this whole reconcile exists for: shards share a replica's slice, and READY used to clear
	// the lot. The second shard to identify therefore erased every guild the first had already announced, and
	// nothing re-announces them -- they stayed missing from the dashboard until the next cold boot.
	await ready('MODMAIL', 0);
	await addGuildToList('MODMAIL', 0, 'shard-0-guild');
	await addGuildToList('MODMAIL', 0, 'shard-1-guild');

	await syncShardGuildList('MODMAIL', 0, ['shard-1-guild'], (guildId) => guildId.startsWith('shard-1'));

	await expect(readGuildList('MODMAIL')).resolves.toStrictEqual(['shard-0-guild', 'shard-1-guild']);
});

test('READY never leaves a window for an in-flight GUILD_CREATE to be lost in', async () => {
	// The single-shard half of the same bug: the old `del` ran before the GUILD_CREATE sweep it was clearing
	// for, so a guild whose event landed in between was erased. Announcing the payload up front means a guild
	// this shard is in survives however the two interleave.
	await ready('AMA', 0);
	await addGuildToList('AMA', 0, 'raced-in');

	await ready('AMA', 0, ['raced-in', 'the-rest']);

	await expect(readGuildList('AMA')).resolves.toStrictEqual(['raced-in', 'the-rest']);
});

test('the heartbeat re-arms the TTL rather than rewriting the set', async () => {
	await ready('AMA', 0);
	await addGuildToList('AMA', 0, '1');

	now += 50_000;
	await expect(touchGuildList('AMA', 0)).resolves.toBe(true);

	// Without the refresh this would have aged out at now + 60s from the add.
	now += 50_000;
	await expect(readGuildList('AMA')).resolves.toStrictEqual(['1']);
});

test('the heartbeat reports a slice that expired underneath it', async () => {
	await ready('AMA', 0);
	await addGuildToList('AMA', 0, '1');
	expireSlice('AMA', 0);

	// `false` is what makes the caller force a re-identify instead of running on an empty guild list.
	await expect(touchGuildList('AMA', 0)).resolves.toBe(false);
});

// The AutoModerator canary crash loop: it was in no guilds, so there was no set key for the heartbeat to
// re-arm, every tick read that as expiry, and the bot SIGTERM'd itself roughly every ten seconds forever.
test('a bot in no guilds stays alive indefinitely', async () => {
	await ready('AUTOMODERATOR', 0);

	for (let tick = 0; tick < 100; tick++) {
		now += 10_000;
		await expect(touchGuildList('AUTOMODERATOR', 0)).resolves.toBe(true);
	}

	await expect(guildListExists('AUTOMODERATOR', 0)).resolves.toBe(true);
	await expect(readGuildList('AUTOMODERATOR')).resolves.toStrictEqual([]);
});

test('a bot in no guilds can resume onto its empty slice', async () => {
	await ready('AUTOMODERATOR', 0);
	await dropGuildList('AUTOMODERATOR', 0);

	// Empty is a legitimate state, not lost state -- reporting `false` here is what forced the re-identify.
	await expect(guildListExists('AUTOMODERATOR', 0)).resolves.toBe(true);
});

test('an empty slice still expires when nothing is heartbeating it', async () => {
	await ready('AUTOMODERATOR', 0);

	now += 61_000;

	await expect(guildListExists('AUTOMODERATOR', 0)).resolves.toBe(false);
	await expect(touchGuildList('AUTOMODERATOR', 0)).resolves.toBe(false);
});

test('the last guild leaving does not read as lost state', async () => {
	await ready('AMA', 0);
	await addGuildToList('AMA', 0, '1');
	await removeGuildFromList('AMA', 0, '1');

	// Redis drops a set the moment its last member goes, so this is the running bot's route into the same
	// zero-guild condition a fresh app boots into.
	await expect(touchGuildList('AMA', 0)).resolves.toBe(true);
	await expect(readGuildList('AMA')).resolves.toStrictEqual([]);
});

test("counts one replica's own slice, never the union", async () => {
	// `discord_guilds` is published per replica and summed by Prometheus, so a count that reached across
	// replicas would multiply the fleet total by the replica count.
	await ready('AMA', 0, ['1', '2']);
	await ready('AMA', 1, ['3']);

	await expect(countGuildList('AMA', 0)).resolves.toBe(2);
	await expect(countGuildList('AMA', 1)).resolves.toBe(1);
});

test('a replica in no guilds counts zero rather than failing', async () => {
	// Redis has no empty sets, so a bot that has joined nothing has no slice key at all -- the same absence the
	// separate liveness marker exists to disambiguate. `SCARD` of a missing key is 0, which here is the truth.
	await ready('AMA', 0);

	await expect(countGuildList('AMA', 0)).resolves.toBe(0);
});
