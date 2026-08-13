import type { BotId } from '@chatsift/core';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';
import { getContext } from '../context.js';
import { RedisStore } from './_store.js';

interface BotInfo {
	guilds: string[];
}

/**
 * The public deployment of a bot keys its guild list on the bare `BotId`. A custom, single-guild ModMail
 * instance (#216, docs/roadmap/01-architecture.md §8) is a second, independently-deployed process sharing that
 * same `BotId`, so it publishes under its own `MODMAIL#<instanceId>` key instead of overwriting the public
 * deployment's.
 */
export type GuildListKey = BotId | `${BotId}#${string}`;

/**
 * How long a replica's published slice survives without being refreshed. `createBotClient` republishes every 10s,
 * so this is six missed writes -- long enough to ride out a slow tick, short enough that a replica which died
 * without releasing its slice stops being counted quickly. Staleness lives in the key's TTL rather than in the
 * value so a dead replica's guilds disappear on their own, with nothing having to notice it died.
 */
const ENTRY_TTL_MS = 60_000;

const store = new RedisStore<BotInfo>({
	TTL: ENTRY_TTL_MS,
	// bin-rw's own inferred type is `(string | null)[] | null` for `guilds` -- every entry here is always a
	// real snowflake, never `null`, so the cast corrects that.
	recipe: createRecipe(
		{
			guilds: [DataType.String],
		},
		{ versioned: true },
	) as Recipe<BotInfo>,
	// `id` here is the composite `<GuildListKey>:<replicaIndex>` built by `entryId` -- see `publishGuildList`.
	makeKey: (id: string) => `guilds:${id}`,
	storeOld: false,
});

const entryId = (id: GuildListKey, replicaIndex: number): string => `${id}:${replicaIndex}`;

/**
 * Set of replica indices currently publishing for this key. Exists so a reader can find every slice in two round
 * trips without `SCAN MATCH guilds:*` -- a match-scan still walks the entire keyspace, which here is dominated by
 * the `discorduser:*` cache and can run to millions of keys.
 */
const indexKey = (id: GuildListKey): string => `guildsreplicas:${id}`;

/**
 * Publishes the guilds *this replica* is responsible for.
 *
 * Sharded horizontally, a replica only ever sees `GUILD_CREATE` for the shards it owns, so no single process
 * knows the whole set. Writing one key per replica and unioning on read is what keeps that correct; a single
 * whole-array key (which is what this was before) would have each replica overwriting the others every 10s and
 * the dashboard flapping between disjoint guild sets. This is the same failure #216 hit with two ModMail
 * deployments sharing one key, and the same fix.
 */
export async function publishGuildList(id: GuildListKey, replicaIndex: number, guilds: string[]): Promise<void> {
	await store.set(entryId(id, replicaIndex), { guilds });
	await getContext().redis.sAdd(indexKey(id), String(replicaIndex));
}

/**
 * Every guild this bot is in, unioned across replicas.
 *
 * An index member whose entry has expired is pruned as it's found, so a replica that goes away for good doesn't
 * leave the set growing forever. Pruning on read (rather than in a sweep) is enough because the set is only ever
 * this small and every reader does it.
 */
export async function readGuildList(id: GuildListKey): Promise<string[]> {
	const { redis } = getContext();
	const members = await redis.sMembers(indexKey(id));
	if (members.length === 0) {
		return [];
	}

	const guilds = new Set<string>();
	const stale: string[] = [];

	await Promise.all(
		members.map(async (member) => {
			const entry = await store.get(entryId(id, Number(member.toString())));
			if (entry) {
				for (const guildId of entry.guilds) {
					guilds.add(guildId);
				}
			} else {
				stale.push(member.toString());
			}
		}),
	);

	if (stale.length > 0) {
		await redis.sRem(indexKey(id), stale);
	}

	return [...guilds];
}

/**
 * Drops this replica's slice, so a graceful shutdown stops counting its guilds immediately rather than leaving
 * them to expire with the key's TTL.
 */
export async function dropGuildList(id: GuildListKey, replicaIndex: number): Promise<void> {
	await store.delete(entryId(id, replicaIndex));
	await getContext().redis.sRem(indexKey(id), String(replicaIndex));
}
