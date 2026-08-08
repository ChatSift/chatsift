import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';
import { getContext } from '../context.js';
import { RedisStore } from './_store.js';

/**
 * The *only* shape this cache ever persists, deliberately narrowed to the public profile fields every
 * consumer actually reads (display name, avatar, bot badge).
 *
 * The narrowing is a security boundary, not just a size optimization. `GET /users/{id}` with a bot token
 * only ever returns public profile data, but `GET /users/@me` with a *user's* OAuth token additionally
 * returns `email`/`verified`/`locale`/`mfa_enabled`/`premium_type` -- so if anything ever fed an OAuth
 * `/users/@me` response into this shared, cross-bot, cross-guild cache, that would leak one user's private
 * fields to every reader of the cache. Encoding through `userRecipe` below structurally drops every field
 * outside this interface, so that class of mistake can't be persisted even if a call site makes it. On top of
 * that, `services/api`'s `/users/@me` call site (`util/me.ts`'s `fetchMe`) never goes through here at all --
 * see its own doc comment.
 *
 * Every field is required-and-present exactly so this is assignable to `@discordjs/core`'s `APIUser` (whose
 * only required fields are `id`/`username`/`discriminator`/`global_name`/`avatar`), letting call sites keep
 * handing cached users to anything that wants an `APIUser` without a cast. The optional fields such a
 * consumer might read (`banner`, `public_flags`, ...) come back `undefined`, which their types already allow.
 */
export interface CachedDiscordUser {
	avatar: string | null;
	bot: boolean;
	discriminator: string;
	global_name: string | null;
	id: string;
	username: string;
}

/**
 * What callers may hand to `primeUserCache`/return from a `fetchUser` -- structurally an `APIUser` (or a
 * gateway payload's user object) without this package needing a dependency on `@discordjs/core`.
 */
export interface DiscordUserLike {
	avatar: string | null;
	bot?: boolean | undefined;
	discriminator: string;
	global_name: string | null;
	id: string;
	username: string;
}

interface CachedUserEntry extends CachedDiscordUser {
	/**
	 * When this entry was last fetched from Discord. Freshness is tracked in the *value* rather than left to
	 * the redis key's TTL because `RedisStore.get` slides that TTL forward on every read -- a user whose
	 * profile is read constantly (an active AMA's author) would otherwise never expire, and a rename would
	 * stick forever. The redis TTL is therefore only a retention bound; `SOFT_TTL_MS` below is what actually
	 * decides staleness.
	 */
	cachedAt: number;
}

// bin-rw's inferred type is wider than `CachedUserEntry` -- every `DataType.String` field decodes as
// `string | null` -- so the cast corrects that, same as `bots.ts`/`me.ts` do for their own recipes.
const userRecipe = createRecipe(
	{
		id: DataType.String,
		username: DataType.String,
		discriminator: DataType.String,
		global_name: DataType.String,
		avatar: DataType.String,
		bot: DataType.Bool,
		cachedAt: DataType.Date,
	},
	{ versioned: true },
) as Recipe<CachedUserEntry>;

// How long an entry is *retained* in redis (slid forward on every read, see `CachedUserEntry.cachedAt`).
// Generous on purpose: a retained-but-stale entry is what lets a read be answered instantly and revalidated
// in the background instead of blocking on Discord's brutally low `GET /users/{id}` limit (30 per 30s per
// token, and `@discordjs/rest` serializes that bucket, so a cold page of 100 distinct authors is minutes of
// queueing).
const HARD_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days
// How long an entry is considered *fresh*. Past this it's still served immediately, with a background
// refresh kicked off (stale-while-revalidate) -- so a rename/avatar change propagates within roughly this
// window without any read ever paying for it.
const SOFT_TTL_MS = 6 * 60 * 60 * 1_000; // 6 hours
// A 404 (deleted account, or an id that was never a user) gets its own much shorter TTL than a positive
// entry: cheap enough to re-check occasionally, long enough that a page full of unresolvable ids doesn't
// re-hammer the rate limit on every single load.
const NEGATIVE_TTL_MS = 30 * 60 * 1_000; // 30 minutes

const store = new RedisStore<CachedUserEntry>({
	TTL: HARD_TTL_MS,
	recipe: userRecipe,
	// Keyed by user id alone -- no bot/guild/instance dimension, unlike `guildDataCache.ts`. `GET /users/{id}`
	// is a *global* lookup returning the same public profile no matter which bot token (or which custom
	// instance's application, #216) asked for it, so there's nothing guild- or bot-specific to partition on and
	// every bot's fetch legitimately answers for every other's -- which is the entire point: the AMA bot
	// resolving a question author warms the same entry ModMail would have paid for separately.
	makeKey: (userId: string) => `discorduser:${userId}`,
	storeOld: false,
});

const negativeKey = (userId: string) => `discorduser:negative:${userId}`;

// Guards the redis key namespace: every id that reaches this module comes from a validated route param, a DB
// column, or a Discord payload, but this cache is written to from more places than most (including bot-side
// gateway priming), so ids are re-checked here rather than trusting every current and future call site not to
// splice something else into a key.
const SNOWFLAKE_PATTERN = /^\d{15,25}$/;

function toEntry(user: DiscordUserLike): CachedUserEntry {
	return {
		id: user.id,
		username: user.username,
		discriminator: user.discriminator,
		global_name: user.global_name,
		avatar: user.avatar,
		bot: user.bot ?? false,
		cachedAt: Date.now(),
	};
}

function toCachedUser({ cachedAt: _, ...user }: CachedUserEntry): CachedDiscordUser {
	return user;
}

const isFresh = (entry: CachedUserEntry): boolean => Date.now() - entry.cachedAt < SOFT_TTL_MS;

// Shared by misses and background revalidations alike, so a page that misses on the same author twice (or a
// read racing the revalidation its own stale hit kicked off) only ever spends one Discord request. Purely an
// in-flight guard -- there's deliberately no process-local copy of resolved users, redis is the single cache
// tier and it's local and fast enough to read on every resolution.
const inflight = new Map<string, Promise<CachedDiscordUser | null>>();

async function fetchAndCache(
	userId: string,
	fetchUser: (userId: string) => Promise<DiscordUserLike | null>,
): Promise<CachedDiscordUser | null> {
	const user = await fetchUser(userId);

	if (!user) {
		await getContext().redis.set(negativeKey(userId), '1', {
			expiration: { type: 'PX', value: NEGATIVE_TTL_MS },
		});
		await store.delete(userId);
		return null;
	}

	const entry = toEntry(user);
	await getContext().redis.del(negativeKey(userId));
	await store.set(userId, entry);

	return toCachedUser(entry);
}

async function dedupedFetch(
	userId: string,
	fetchUser: (userId: string) => Promise<DiscordUserLike | null>,
): Promise<CachedDiscordUser | null> {
	const existing = inflight.get(userId);
	if (existing) {
		return existing;
	}

	const promise = (async () => {
		try {
			return await fetchAndCache(userId, fetchUser);
		} finally {
			inflight.delete(userId);
		}
	})();

	inflight.set(userId, promise);
	return promise;
}

function revalidateInBackground(userId: string, fetchUser: (userId: string) => Promise<DiscordUserLike | null>): void {
	// Deliberately not awaited: the caller already has a usable (if stale) answer, and the whole point is that
	// it doesn't wait behind the `GET /users/{id}` queue. A failure here is logged and dropped -- the stale
	// entry simply stays until the next read tries again.
	void (async () => {
		try {
			await dedupedFetch(userId, fetchUser);
		} catch (error) {
			getContext().logger.warn({ err: error, userId }, 'failed to revalidate cached discord user');
		}
	})();
}

/**
 * Resolves a Discord user through the shared redis cache, falling back to `fetchUser` (the caller's own
 * Discord call, which must map a 404 to `null` and let anything else throw) only on a real miss.
 *
 * Shared by every bot and by the API, keyed on user id alone -- see `store`'s `makeKey` comment for why
 * that's safe, and `CachedDiscordUser`'s for what may and may not be persisted here.
 *
 * `null` means Discord doesn't know this user (deleted account, or never existed); callers typically render
 * the bare snowflake in that case.
 */
export async function fetchUserCached(
	userId: string,
	fetchUser: (userId: string) => Promise<DiscordUserLike | null>,
): Promise<CachedDiscordUser | null> {
	// An id that isn't a snowflake can't be in the cache and mustn't be written into a key -- pass it through
	// to Discord (which will 404 it) without touching redis at all.
	if (!SNOWFLAKE_PATTERN.test(userId)) {
		const user = await fetchUser(userId);
		return user ? toCachedUser(toEntry(user)) : null;
	}

	const cached = await store.get(userId);
	if (cached) {
		if (!isFresh(cached)) {
			revalidateInBackground(userId, fetchUser);
		}

		return toCachedUser(cached);
	}

	if (await getContext().redis.exists(negativeKey(userId))) {
		return null;
	}

	return dedupedFetch(userId, fetchUser);
}

/**
 * Writes a user the caller already has in hand into the cache, at no Discord-request cost.
 *
 * The point of the cross-bot cache: a bot handling an interaction already holds the acting user's full
 * profile in the gateway payload, so priming here means the dashboard resolving that same user later
 * (e.g. an AMA question's author, minutes after they submitted it) is a cache hit instead of a request
 * against a 30-per-30s bucket.
 *
 * Only ever pass a user object Discord itself sent for *that* user -- never a `/users/@me` response fetched
 * with someone's OAuth token (see `CachedDiscordUser`). Fire-and-forget: priming is an optimization, so a
 * redis hiccup is logged rather than surfaced to a caller that has nothing useful to do about it.
 */
export function primeUserCache(user: DiscordUserLike): void {
	if (!SNOWFLAKE_PATTERN.test(user.id)) {
		return;
	}

	const entry = toEntry(user);

	void (async () => {
		try {
			await getContext().redis.del(negativeKey(entry.id));
			await store.set(entry.id, entry);
		} catch (error) {
			getContext().logger.warn({ err: error, userId: entry.id }, 'failed to prime discord user cache');
		}
	})();
}
