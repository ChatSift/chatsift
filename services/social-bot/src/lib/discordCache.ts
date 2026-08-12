import { getContext, RedisStore } from '@chatsift/backend-core';
import { createInflightDeduper } from '@chatsift/core';
import { DiscordAPIError } from '@discordjs/rest';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';

/**
 * Discord state the leveling engine needs that a `MESSAGE_CREATE` payload doesn't carry, cached in redis in the
 * same shape as the shared user cache (`packages/private/backend-core/src/lib/data/users.ts`): lazily fetched on
 * miss, negatively cached on 403/404, and de-duplicated while in flight.
 *
 * Redis rather than a process-local map so the cache survives restarts and is shared across replicas -- the
 * alternative (rebuilding topology from `GUILD_CREATE` on every boot) makes a restart cost a full re-fetch and
 * leaves each replica warming its own copy.
 */

interface CachedChannel {
	/**
	 * `null` is a real, cacheable answer -- a top-level channel with no category -- and is what ends the parent
	 * walk. It is not the same as a cache miss.
	 */
	parentId: string | null;
}

interface CachedGuild {
	name: string;
	/**
	 * Role names and positions, held as parallel arrays because bin-rw recipes have no map type. Only read when
	 * rendering a level-up notification's `{{ earnedRewards }}` or a `/level` reply, so the shape never matters
	 * on the hot path.
	 */
	roleIds: string[];
	roleNames: string[];
	/**
	 * Discord's own hierarchy index -- higher is higher up the role list. `/level` sorts by it so the roles it
	 * lists read in the order the server itself shows them, rather than in primary-key order.
	 */
	rolePositions: number[];
}

// Channel topology changes rarely and a stale answer is cheap (one message tracked against the wrong category),
// so this leans long. `RedisStore.get` slides the TTL forward on read, so an actively-used channel effectively
// never expires -- acceptable here, unlike the user cache, because a channel's *parent* is close to immutable
// where a username is not.
const CHANNEL_TTL_MS = 6 * 60 * 60 * 1_000; // 6 hours
const GUILD_TTL_MS = 60 * 60 * 1_000; // 1 hour
// A channel the bot can't see (deleted, or permissions revoked) gets a much shorter entry, so a busy channel
// that becomes unreadable doesn't re-hammer the REST bucket on every message, but a restored permission
// recovers quickly.
const NEGATIVE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

const channelStore = new RedisStore<CachedChannel>({
	TTL: CHANNEL_TTL_MS,
	recipe: createRecipe({ parentId: DataType.String }, { versioned: true }) as Recipe<CachedChannel>,
	// No bot/guild dimension: a channel id is globally unique and this service is a single deployment, unlike
	// ModMail's per-instance caches (#216).
	makeKey: (channelId: string) => `socialchannel:${channelId}`,
	storeOld: false,
});

const guildStore = new RedisStore<CachedGuild>({
	TTL: GUILD_TTL_MS,
	recipe: createRecipe(
		{
			name: DataType.String,
			roleIds: [DataType.String],
			roleNames: [DataType.String],
			rolePositions: [DataType.I32],
		},
		{ versioned: true },
	) as Recipe<CachedGuild>,
	makeKey: (guildId: string) => `socialguild:${guildId}`,
	storeOld: false,
});

const channelNegativeKey = (channelId: string) => `socialchannel:negative:${channelId}`;
const guildNegativeKey = (guildId: string) => `socialguild:negative:${guildId}`;

// Purely an in-flight guard, exactly as the user cache does it: several messages landing in the same
// uncached channel at once share one Discord request instead of each issuing their own.
const inflight = createInflightDeduper();

/**
 * A 403/404 means the bot can't see this thing -- a real answer worth caching, not a transient failure. Anything
 * else (a 5xx, a timeout) propagates, so a Discord outage doesn't get baked into the cache as "gone".
 */
function isMissing(error: unknown): boolean {
	return error instanceof DiscordAPIError && (error.status === 403 || error.status === 404);
}

async function loadChannel(channelId: string): Promise<CachedChannel | null> {
	if (await getContext().redis.exists(channelNegativeKey(channelId))) {
		return null;
	}

	const cached = await channelStore.get(channelId);
	if (cached) {
		return cached;
	}

	return inflight.run(`channel:${channelId}`, async () => {
		try {
			const channel = await getContext().service.client.api.channels.get(channelId);
			const entry: CachedChannel = { parentId: 'parent_id' in channel ? (channel.parent_id ?? null) : null };

			await getContext().redis.del(channelNegativeKey(channelId));
			await channelStore.set(channelId, entry);

			return entry;
		} catch (error) {
			if (!isMissing(error)) {
				throw error;
			}

			await getContext().redis.set(channelNegativeKey(channelId), '1', {
				expiration: { type: 'PX', value: NEGATIVE_TTL_MS },
			});

			return null;
		}
	});
}

async function loadGuild(guildId: string): Promise<CachedGuild | null> {
	if (await getContext().redis.exists(guildNegativeKey(guildId))) {
		return null;
	}

	const cached = await guildStore.get(guildId);
	if (cached) {
		return cached;
	}

	return inflight.run(`guild:${guildId}`, async () => {
		try {
			// `GET /guilds/{id}` carries the roles inline, so the guild name and every role name a level-up
			// notification could need come from a single request.
			const guild = await getContext().service.client.api.guilds.get(guildId);
			const entry: CachedGuild = {
				name: guild.name,
				roleIds: guild.roles.map((role) => role.id),
				roleNames: guild.roles.map((role) => role.name),
				rolePositions: guild.roles.map((role) => role.position),
			};

			await getContext().redis.del(guildNegativeKey(guildId));
			await guildStore.set(guildId, entry);

			return entry;
		} catch (error) {
			if (!isMissing(error)) {
				throw error;
			}

			await getContext().redis.set(guildNegativeKey(guildId), '1', {
				expiration: { type: 'PX', value: NEGATIVE_TTL_MS },
			});

			return null;
		}
	});
}

/**
 * The message's own channel, then its parent, then -- for a thread -- its parent's parent, in that order.
 *
 * That third hop is what lets a `social_channels` row on a *category* apply to a thread inside a text or forum
 * channel in it. Callers resolve `ignored`/`multiplier` against the first configured channel in this list, so the
 * ordering is load-bearing: the most specific configured row wins.
 *
 * An unresolvable channel simply ends the chain rather than failing the message -- the worst case is one message
 * tracked without its category's multiplier.
 */
export async function resolveChannelChain(channelId: string): Promise<string[]> {
	const chain = [channelId];

	const channel = await loadChannel(channelId);
	if (!channel?.parentId) {
		return chain;
	}

	chain.push(channel.parentId);

	const parent = await loadChannel(channel.parentId);
	if (parent?.parentId) {
		chain.push(parent.parentId);
	}

	return chain;
}

/**
 * Used for the `{{ earnedRewards }}` level-up placeholder. `undefined` for a role that's been deleted (or a guild
 * that can't be read), which callers drop rather than rendering a dangling id.
 */
export async function getRoleName(guildId: string, roleId: string): Promise<string | undefined> {
	const guild = await loadGuild(guildId);
	if (!guild) {
		return undefined;
	}

	const index = guild.roleIds.indexOf(roleId);
	return index === -1 ? undefined : guild.roleNames[index];
}

/**
 * Reorders role ids into the guild's own hierarchy, highest first -- the order Discord itself lists roles in, and
 * therefore the only order a reply naming several of them doesn't look shuffled. Ids the guild doesn't have (a
 * deleted reward role) sort last rather than being dropped, since the caller decides whether an unresolvable
 * mention is worth showing.
 *
 * Falls back to the input order if the guild can't be read at all.
 */
export async function sortRoleIdsByHierarchy(guildId: string, roleIds: readonly string[]): Promise<string[]> {
	const guild = await loadGuild(guildId);
	if (!guild) {
		return [...roleIds];
	}

	const positionOf = (roleId: string) => {
		const index = guild.roleIds.indexOf(roleId);
		return index === -1 ? Number.NEGATIVE_INFINITY : (guild.rolePositions[index] ?? Number.NEGATIVE_INFINITY);
	};

	return [...roleIds].sort((left, right) => positionOf(right) - positionOf(left));
}

/**
 * Used for the `{{ guildName }}` level-up placeholder.
 */
export async function getGuildName(guildId: string): Promise<string | undefined> {
	return (await loadGuild(guildId))?.name;
}
