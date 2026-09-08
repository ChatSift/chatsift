import { getContext, RedisStore } from '@chatsift/backend-core';
import { createInflightDeduper } from '@chatsift/core';
import type { API, Snowflake } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';
import { getSelfId } from './selfId.js';

/**
 * What this cache persists about a channel, narrowed to the two facts its readers actually need: `parentId`
 * for `channelChain.ts`'s walk up the tree, and `archived` for `services/modmail-bot`'s auto-archive sweep.
 *
 * Nothing here is bot-specific -- `GET /channels/{id}` answers the same for every token that can see the
 * channel -- so entries are keyed on the channel id alone and one bot's fetch legitimately answers for every
 * other's, exactly like `backend-core`'s shared user cache. Negative entries are the one exception, see
 * `negativeKey`.
 */
export interface CachedChannel {
	/**
	 * `null` for a channel that is not a thread, which is a different answer from `false` ("a thread that is
	 * not currently archived") -- only the latter is something the sweep can act on.
	 */
	archived: boolean | null;
	id: string;
	/**
	 * `null` is a real, cacheable answer -- a top-level channel with no category -- and is what ends the chain
	 * walk. It is not the same as a cache miss.
	 */
	parentId: string | null;
}

interface CachedChannelEntry extends CachedChannel {
	/**
	 * When this entry was last written, from Discord or from a gateway payload. Freshness is tracked in the
	 * value itself rather than left to the redis key's TTL, because `RedisStore.get` slides that TTL forward on
	 * every read -- a channel a sweep reads every five minutes would otherwise never expire, and a thread
	 * archived out from under us would stay `false` forever. The redis TTL is only a retention bound.
	 */
	cachedAt: number;
}

/**
 * What callers may hand to {@link primeChannelCache}: structurally a channel, whether it came from
 * `GET /channels/{id}`, a `PATCH` response, or a gateway dispatch. Deliberately structural rather than
 * `APIChannel` so a partial gateway payload is assignable without a cast -- an absent `thread_metadata` and a
 * non-thread channel are the same answer here, which is exactly what {@link CachedChannel.archived} encodes.
 */
export interface DiscordChannelLike {
	id: string;
	parent_id?: string | null | undefined;
	thread_metadata?: { archived: boolean } | null | undefined;
}

// bin-rw's inferred type is wider than `CachedChannelEntry` -- every field decodes as `T | null` -- so the
// cast corrects that, same as `backend-core`'s `data/users.ts` does for its own recipe.
const channelRecipe = createRecipe(
	{
		id: DataType.String,
		parentId: DataType.String,
		archived: DataType.Bool,
		cachedAt: DataType.Date,
	},
	{ versioned: true },
) as Recipe<CachedChannelEntry>;

// How long an entry is *retained* in redis (slid forward on every read, see `CachedChannelEntry.cachedAt`).
// Generous on purpose: a retained entry is what lets a read be answered without a request at all, and how
// stale it may be before a reader refreshes it is that reader's call, via `FetchChannelOptions.maxAge`.
const HARD_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days
// A channel the bot can't see (deleted, or permissions revoked) gets a much shorter entry, so a busy channel
// that becomes unreadable doesn't re-hammer the REST bucket on every message, but a restored permission
// recovers quickly.
const NEGATIVE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * How far either side of a reader's `maxAge` an entry's real staleness threshold is spread.
 *
 * A reader that fills the cache for N channels in one pass -- which is exactly what modmail's auto-archive
 * sweep does on a cold start -- would otherwise have all N cross that threshold in the same instant and
 * revalidate in one burst, which is the request spike this cache exists to remove. Derived from the channel id
 * rather than rolled per read, so an entry's threshold is stable across reads and across replicas.
 */
const MAX_AGE_JITTER_RATIO = 0.25;

const store = new RedisStore<CachedChannelEntry>({
	TTL: HARD_TTL_MS,
	recipe: channelRecipe,
	makeKey: (channelId: string) => `discordchannel:${channelId}`,
	storeOld: false,
});

/**
 * Negative entries, unlike positive ones, are **per bot**: a 404 is objective, but a 403 says only that *this*
 * token can't see the channel, and sharing that would blind a bot that can. The value is the status itself so
 * a reader can still tell "gone" from "not allowed", which is the difference between closing a modmail ticket
 * and leaving it open.
 */
async function negativeKey(api: API, channelId: string): Promise<string> {
	return `discordchannel:negative:${await getSelfId(api)}:${channelId}`;
}

// Purely an in-flight guard, exactly as the shared user cache does it: several readers landing on the same
// uncached channel at once share one Discord request instead of each issuing their own.
const inflight = createInflightDeduper();

// Guards the redis key namespace: every id that reaches this module comes from a DB column or a Discord
// payload, but this cache is written to from more places than most (every bot's gateway priming included), so
// ids are re-checked here rather than trusting every current and future call site not to splice something
// else into a key.
const SNOWFLAKE_PATTERN = /^\d{15,25}$/;

export interface FetchChannelOptions {
	/**
	 * How old a retained entry may be, in milliseconds, before it is refreshed. The stale value is still
	 * returned immediately and the refresh runs in the background (stale-while-revalidate), so a reader never
	 * blocks on Discord for a channel it has already seen.
	 *
	 * Omitted means any retained entry is acceptable -- the right choice for a reader that only wants
	 * `parentId`, which changes rarely and which `CHANNEL_UPDATE` priming corrects when it does.
	 */
	maxAge?: number | undefined;
}

/**
 * The outcome of a channel lookup. `forbidden` and `missing` are split apart rather than collapsed into a
 * single "unreadable" because they call for opposite responses: 403 is a live permissions problem someone can
 * fix and the caller should wait it out, 404 is terminal.
 */
export type ChannelLookup =
	{ channel: CachedChannel; state: 'ok' } | { channel: null; state: 'forbidden' } | { channel: null; state: 'missing' };

function toEntry(channel: DiscordChannelLike): CachedChannelEntry {
	return {
		archived: channel.thread_metadata ? channel.thread_metadata.archived : null,
		cachedAt: Date.now(),
		id: channel.id,
		parentId: channel.parent_id ?? null,
	};
}

function toChannel({ cachedAt: _, ...channel }: CachedChannelEntry): CachedChannel {
	return channel;
}

function jitteredMaxAge(channelId: string, maxAge: number): number {
	let hash = 0;
	for (const character of channelId) {
		hash = (hash * 31 + character.codePointAt(0)!) % 1_000;
	}

	return maxAge * (1 - MAX_AGE_JITTER_RATIO + (2 * MAX_AGE_JITTER_RATIO * hash) / 1_000);
}

async function readNegative(api: API, channelId: string): Promise<403 | 404 | null> {
	const raw = await getContext().redis.get(await negativeKey(api, channelId));
	if (!raw) {
		return null;
	}

	return raw.toString() === '403' ? 403 : 404;
}

/**
 * `cache: false` is the escape hatch for an id that must never be written into a redis key (see
 * `SNOWFLAKE_PATTERN`) -- it still asks Discord, it just doesn't remember the answer.
 */
async function loadChannel(api: API, channelId: string, cache: boolean): Promise<ChannelLookup> {
	try {
		const channel = await api.channels.get(channelId);
		const entry = toEntry(channel);

		if (cache) {
			// No `del` of the negative key here: the read path checks the positive entry first, so an entry
			// written here shadows any negative one for as long as it lives and the stale negative just expires.
			await store.set(channelId, entry);
		}

		return { channel: toChannel(entry), state: 'ok' };
	} catch (error) {
		if (!(error instanceof DiscordAPIError) || (error.status !== 403 && error.status !== 404)) {
			throw error;
		}

		const status = error.status === 403 ? 403 : 404;

		// Debug, not warn: the chain walk routinely reaches categories nobody granted the bot access to, and
		// every reader degrades gracefully when it does. Logged at all because "the category setting isn't
		// applying" otherwise looks identical to a bad configuration row.
		getContext().logger.debug({ err: error, channelId }, 'channel unreadable');

		if (cache) {
			await store.delete(channelId);
			await getContext().redis.set(await negativeKey(api, channelId), String(status), {
				expiration: { type: 'PX', value: NEGATIVE_TTL_MS },
			});
		}

		return { channel: null, state: status === 403 ? 'forbidden' : 'missing' };
	}
}

function revalidateInBackground(api: API, channelId: string): void {
	// Deliberately not awaited: the caller already has a usable (if stale) answer, and the whole point is that
	// no read waits on Discord for a channel it has seen before. A failure here is logged and dropped -- the
	// stale entry simply stays until the next read tries again.
	void (async () => {
		try {
			await inflight.run(`discordchannel:${channelId}`, async () => loadChannel(api, channelId, true));
		} catch (error) {
			getContext().logger.warn({ err: error, channelId }, 'failed to revalidate cached discord channel');
		}
	})();
}

/**
 * Resolves a channel through the shared redis cache, falling back to `GET /channels/{id}` only on a real miss.
 *
 * Anything other than a 403/404 still throws, exactly like a bare `channels.get` -- a Discord outage must not
 * get baked into the cache as "gone".
 */
export async function fetchChannel(
	api: API,
	channelId: Snowflake,
	options: FetchChannelOptions = {},
): Promise<ChannelLookup> {
	// An id that isn't a snowflake can't be in the cache and mustn't be written into a key -- pass it through
	// to Discord (which will 404 it) without touching redis at all.
	if (!SNOWFLAKE_PATTERN.test(channelId)) {
		return loadChannel(api, channelId, false);
	}

	const cached = await store.get(channelId);
	if (cached) {
		if (options.maxAge !== undefined && Date.now() - cached.cachedAt >= jitteredMaxAge(channelId, options.maxAge)) {
			revalidateInBackground(api, channelId);
		}

		return { channel: toChannel(cached), state: 'ok' };
	}

	const negative = await readNegative(api, channelId);
	if (negative) {
		return { channel: null, state: negative === 403 ? 'forbidden' : 'missing' };
	}

	return inflight.run(`discordchannel:${channelId}`, async () => loadChannel(api, channelId, true));
}

/**
 * Writes a channel the caller already holds into the cache, at no Discord-request cost.
 *
 * This is what the gateway priming in `client.ts` is for: `THREAD_UPDATE` is the event that says a thread's
 * `archived` flag changed, and `GUILD_CREATE` names every active thread the bot is in, so a bot that listens
 * to both mostly never has to ask. Also worth calling after a `PATCH` that returns the updated channel, so the
 * cache reflects the write that just happened rather than the state before it.
 *
 * Fire-and-forget: priming is an optimization, so a redis hiccup is logged rather than surfaced to a gateway
 * handler that has nothing useful to do about it.
 */
export function primeChannelCache(channel: DiscordChannelLike): void {
	if (!SNOWFLAKE_PATTERN.test(channel.id)) {
		return;
	}

	const entry = toEntry(channel);

	void (async () => {
		try {
			await store.set(entry.id, entry);
		} catch (error) {
			getContext().logger.warn({ err: error, channelId: entry.id }, 'failed to prime discord channel cache');
		}
	})();
}

/**
 * Drops a channel's entry, for `CHANNEL_DELETE`/`THREAD_DELETE`.
 *
 * Only the positive entry: those payloads are partial channels, so there is nothing worth caching in them, and
 * dropping the entry is what makes the next reader ask Discord and establish the 404 for itself. Without this
 * a deleted thread would keep answering from its last known state until `maxAge` lapsed -- and for modmail
 * that 404 is what closes a ticket whose thread was deleted out of band.
 */
export function forgetChannel(channelId: Snowflake): void {
	if (!SNOWFLAKE_PATTERN.test(channelId)) {
		return;
	}

	void (async () => {
		try {
			await store.delete(channelId);
		} catch (error) {
			getContext().logger.warn({ err: error, channelId }, 'failed to evict cached discord channel');
		}
	})();
}
