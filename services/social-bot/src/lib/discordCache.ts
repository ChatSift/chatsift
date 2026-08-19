import { getContext, RedisStore } from '@chatsift/backend-core';
import { resolveChannelChain as resolveSharedChannelChain } from '@chatsift/bot-core';
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
 *
 * The **channel** half of this moved to `@chatsift/bot-core`'s `channelChain.ts` when AutoModerator's log
 * exemptions (P4, feature 35) needed the identical three-level walk; what remains here is the guild/role state,
 * which only Social reads.
 */

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

const GUILD_TTL_MS = 60 * 60 * 1_000; // 1 hour
// A guild the bot can't see (kicked, or a Discord blip) gets a much shorter entry, so it doesn't re-hammer the
// REST bucket on every message, but a restored install recovers quickly.
const NEGATIVE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

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

			// Warn, unlike the channel case: an unreadable guild silently degrades three user-visible things
			// for the whole negative-cache window -- reward ties lose the role hierarchy, `{{ guildName }}`
			// renders as "this server", and every earned reward is dropped from the level-up message. All
			// three read as config bugs from the outside.
			getContext().logger.warn({ err: error, guildId }, 'Social guild unreadable, negatively caching');

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
 *
 * A thin wrapper over `@chatsift/bot-core`'s shared walk, kept so this module stays the one place Social's
 * leveling code asks about Discord state. The cache behind it now serves AutoModerator's log exemptions too.
 */
export async function resolveChannelChain(channelId: string): Promise<string[]> {
	return resolveSharedChannelChain(getContext().service.client.api, channelId);
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
 * The guild's role hierarchy, in the shape `@chatsift/core`'s reward rules break their ties on. Empty when the
 * guild can't be read, which those rules already treat as "no hierarchy known" and fall back to role ids for.
 *
 * Reads through the same hour-long redis entry as every other guild lookup here, so the reward path pays a
 * cached read per grant rather than a Discord request.
 */
export async function getRolePositions(guildId: string): Promise<Map<string, number>> {
	const guild = await loadGuild(guildId);
	if (!guild) {
		return new Map();
	}

	return new Map(
		guild.roleIds.flatMap((roleId, index) => {
			const position = guild.rolePositions[index];
			return position === undefined ? [] : [[roleId, position] as const];
		}),
	);
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
	const positions = await getRolePositions(guildId);
	if (positions.size === 0) {
		return [...roleIds];
	}

	const positionOf = (roleId: string) => positions.get(roleId) ?? Number.NEGATIVE_INFINITY;

	return [...roleIds].sort((left, right) => positionOf(right) - positionOf(left));
}

/**
 * Used for the `{{ guildName }}` level-up placeholder.
 */
export async function getGuildName(guildId: string): Promise<string | undefined> {
	return (await loadGuild(guildId))?.name;
}
