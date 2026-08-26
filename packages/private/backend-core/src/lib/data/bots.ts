import type { BotId } from '@chatsift/core';
import { getContext } from '../context.js';

/**
 * The public deployment of a bot keys its guild list on the bare `BotId`. A custom, single-guild ModMail
 * instance (#216, docs/roadmap/01-architecture.md §8) is a second, independently-deployed process sharing that
 * same `BotId`, so it publishes under its own `MODMAIL#<instanceId>` key instead of overwriting the public
 * deployment's.
 */
export type GuildListKey = BotId | `${BotId}#${string}`;

/**
 * How long a replica's set of guilds survives without being touched
 */
const ENTRY_TTL_MS = 60_000;

/**
 * The guild set for one replica of one bot
 */
const guildsKey = (id: GuildListKey, replicaIndex: number): string => `guilds:${id}:${replicaIndex}`;

/**
 * Liveness marker for one replica's slice, and the only thing TTL-expiry is read off.
 *
 * Separate from the set because redis has no empty sets: a bot in zero guilds (a fresh app, a canary) has no
 * `guildsKey` to exist or be re-armed, which is indistinguishable from an expired one. Inferring liveness from
 * the set therefore crash-looped such a bot -- every heartbeat reported lost state and forced a re-identify.
 */
const liveKey = (id: GuildListKey, replicaIndex: number): string => `guildslive:${id}:${replicaIndex}`;

/**
 * Set of replica indices currently publishing for this key.
 */
const indexKey = (id: GuildListKey): string => `guildsreplicas:${id}`;

/**
 * Brings this replica's slice in line with what one shard just reported at READY, and registers it as
 * publishing.
 *
 * Reconciles rather than clears, because `Ready` fires per *shard* while the slice is keyed per *replica*: a
 * bot running two shards on one process had the second shard's identify wipe every guild the first had already
 * announced, and nothing ever re-announces those, so they stayed invisible to the dashboard until the next cold
 * boot. `clearable` is what keeps a shard to its own guilds; everything else in the slice belongs to a sibling
 * and is left for that shard's own READY.
 *
 * Reconciling also closes the narrower race the old wholesale `del` had even on a single-shard bot -- there is
 * no longer a window where the slice is empty for an in-flight `GUILD_CREATE` to be lost in.
 */
export async function syncShardGuildList(
	id: GuildListKey,
	replicaIndex: number,
	guildIds: readonly string[],
	clearable: (guildId: string) => boolean,
): Promise<void> {
	const { redis } = getContext();
	const key = guildsKey(id, replicaIndex);
	const announced = new Set(guildIds);

	// A guild left while this shard was offline produces no GUILD_DELETE it can ever see, so READY's payload is
	// the only thing that notices it is gone.
	const stale = (await redis.sMembers(key))
		.map((guildId) => guildId.toString())
		.filter((guildId) => !announced.has(guildId) && clearable(guildId));

	if (stale.length > 0) {
		await redis.sRem(key, stale);
	}

	if (announced.size > 0) {
		await redis.sAdd(key, [...announced]);
		await redis.pExpire(key, ENTRY_TTL_MS);
	}

	await redis.set(liveKey(id, replicaIndex), '1', { expiration: { type: 'PX', value: ENTRY_TTL_MS } });
	await redis.sAdd(indexKey(id), String(replicaIndex));
}

/**
 * Whether this replica still has a slice. A resume that finds none has lost state it cannot rebuild from the
 * gateway -- see `bot-core/src/lib/client.ts` for what it does about that. Note that an *empty* slice is still a
 * slice: being in no guilds is a legitimate state, not lost state.
 */
export async function guildListExists(id: GuildListKey, replicaIndex: number): Promise<boolean> {
	return (await getContext().redis.exists(liveKey(id, replicaIndex))) === 1;
}

export async function addGuildToList(id: GuildListKey, replicaIndex: number, guildId: string): Promise<void> {
	const { redis } = getContext();
	await redis.sAdd(guildsKey(id, replicaIndex), guildId);
	await redis.pExpire(guildsKey(id, replicaIndex), ENTRY_TTL_MS);
	await redis.sAdd(indexKey(id), String(replicaIndex));
}

export async function removeGuildFromList(id: GuildListKey, replicaIndex: number, guildId: string): Promise<void> {
	await getContext().redis.sRem(guildsKey(id, replicaIndex), guildId);
}

/**
 * Returns `false` when the liveness marker is already gone, which means this replica's slice expired underneath
 * it -- the same lost-state condition `guildListExists` reports on resume. The guild set is re-armed alongside
 * it, but its own result is deliberately ignored: it is legitimately absent whenever the bot is in no guilds.
 */
export async function touchGuildList(id: GuildListKey, replicaIndex: number): Promise<boolean> {
	const { redis } = getContext();
	const refreshed = await redis.pExpire(liveKey(id, replicaIndex), ENTRY_TTL_MS);
	if (!refreshed) {
		return false;
	}

	await redis.pExpire(guildsKey(id, replicaIndex), ENTRY_TTL_MS);
	// Re-registered on every heartbeat so a replica that was dropped from the index by a graceful shutdown, then
	// came back on a resumed session, becomes discoverable again without needing a READY to do it.
	await redis.sAdd(indexKey(id), String(replicaIndex));
	return true;
}

/**
 * Every guild this bot is in, unioned across replicas.
 */
export async function readGuildList(id: GuildListKey): Promise<string[]> {
	const { redis } = getContext();
	const replicas = await redis.sMembers(indexKey(id));
	if (replicas.length === 0) {
		return [];
	}

	const guilds = new Set<string>();
	const stale: string[] = [];

	await Promise.all(
		replicas.map(async (replica) => {
			const replicaIndex = replica.toString();

			if ((await redis.exists(liveKey(id, Number(replicaIndex)))) !== 1) {
				stale.push(replicaIndex);
				return;
			}

			// Absent when the replica is live but in no guilds, which `sMembers` reports as empty either way.
			for (const guildId of await redis.sMembers(guildsKey(id, Number(replicaIndex)))) {
				guilds.add(guildId.toString());
			}
		}),
	);

	if (stale.length > 0) {
		await redis.sRem(indexKey(id), stale);
	}

	return [...guilds];
}

/**
 * Stops this replica being counted, so a graceful shutdown drops its guilds from the union immediately rather
 * than leaving them advertised until the TTL runs out.
 */
export async function dropGuildList(id: GuildListKey, replicaIndex: number): Promise<void> {
	await getContext().redis.sRem(indexKey(id), String(replicaIndex));
}
