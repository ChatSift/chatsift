import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { BotId, Instance, Logger } from '@chatsift/backend-core';
import {
	BOTS,
	getAllInstances,
	getContext,
	getInstanceForGuild,
	PermissionsBitField,
	promiseAllObject,
	readGuildList,
	RedisStore,
} from '@chatsift/backend-core';
import type { AmaSessions, DashboardGrants } from '@chatsift/db';
import type { APIUser, RESTAPIPartialCurrentUserGuild } from '@discordjs/core';
import { PermissionFlagsBits } from '@discordjs/core';
import { unauthorized } from '@hapi/boom';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType, stringLiteral } from 'bin-rw';
import { apiForGuild, discordAPIOAuth } from './discordAPI.js';
import { getInstanceBranding } from './discordApplication.js';
import { isNotFoundDiscordError } from './discordErrors.js';
import { resolveDiscordUserOrNull } from './users.js';

export type MeGuild = Pick<RESTAPIPartialCurrentUserGuild, 'icon' | 'id' | 'name'> & {
	/**
	 * AMA session ids in this guild where the logged-in user is a configured guest
	 * (`ama_sessions.guest_ids`), regardless of `meCanManage`/actual Discord guild membership -- backs
	 * the dashboard's scoped guest access (see `middleware/isAuthed.ts`'s `'or-ama-guest'` path for the
	 * API-side authorization this mirrors). Empty when the user isn't an AMA guest in this guild at all.
	 */
	amaGuestSessionIds: number[];
	bots: BotId[];
	/**
	 * This guild's owning custom instance (#216), or `null` for a guild served by the public deployment.
	 * `customInstanceIconUrl` can still be `null` alongside a non-null `customInstanceId` -- the instance's
	 * Discord application simply has no icon set, or resolving it failed and this fell back gracefully.
	 */
	customInstanceIconUrl: string | null;
	customInstanceId: string | null;
	customInstanceLabel: string | null;
	meCanManage: boolean;
};

// Only the fields the dashboard actually reads off the Discord user (id/avatar/username for display,
// discriminator/global_name for the legacy-tag fallback) -- narrowed (rather than the full `APIUser` this used to
// spread verbatim) so the redis-backed cache below (#246) has a fixed shape to encode with bin-rw. Pick from
// `APIUser` directly so a future field this app starts using is a one-line addition here.
export type Me = Pick<APIUser, 'avatar' | 'discriminator' | 'global_name' | 'id' | 'username'> & {
	guilds: MeGuild[];
	isGlobalAdmin: boolean;
};

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

// bin-rw's own inferred type is wider than `Me`: every `DataType.String`/`stringLiteral` field decodes as
// `string | null` (or `BotId | null` for `bots`), whereas `global_name`/`avatar`/`icon` are the only fields
// that are genuinely nullable here -- the cast corrects that. Shared between `MeStore` and `ScopedMeStore`
// below, since both cache the exact same `Me` shape, just under a different key scheme.
const meRecipe = createRecipe(
	{
		id: DataType.String,
		username: DataType.String,
		discriminator: DataType.String,
		global_name: DataType.String,
		avatar: DataType.String,
		isGlobalAdmin: DataType.Bool,
		guilds: [
			{
				id: DataType.String,
				name: DataType.String,
				icon: DataType.String,
				meCanManage: DataType.Bool,
				bots: [stringLiteral<BotId>()],
				amaGuestSessionIds: [DataType.I32],
				customInstanceId: DataType.String,
				customInstanceLabel: DataType.String,
				customInstanceIconUrl: DataType.String,
			},
		],
	},
	{ versioned: true },
) as Recipe<Me>;

const MeStore = new RedisStore<Me>({
	TTL: CACHE_TTL_MS,
	recipe: meRecipe,
	// Hashed rather than keyed by the raw access token -- unlike the in-memory `Map` this replaced, this value is
	// persisted in redis (visible to anything with redis access via KEYS/MONITOR/RDB dumps), so the key itself
	// shouldn't double as a live OAuth credential.
	makeKey: (tokenHash: string) => `me:${tokenHash}`,
	storeOld: false,
});

// Keyed by `guildId:sub` rather than a token hash -- a scoped session has no long-lived Discord credential to
// hash (see `fetchMeForScopedSession`), and every session minted for the same (guild, user) pair would want to
// share this entry anyway.
const ScopedMeStore = new RedisStore<Me>({
	TTL: CACHE_TTL_MS,
	recipe: meRecipe,
	makeKey: (id: string) => `me:scoped:${id}`,
	storeOld: false,
});

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * In-flight de-duplication for both `fetchMe` and `fetchMeForScopedSession` (own map each, since their keys
 * mean different things). A dashboard page load fires ~7 requests in parallel, every one of which runs
 * `isAuthed` -- so on a cold cache all 7 used to miss `MeStore` simultaneously and each make its own
 * `/users/@me` + `/users/@me/guilds` pair. `/users/@me/guilds` allows *one* request per second per user
 * token, so 6 of those 7 got rate limited and the whole page load serialized behind ~6 seconds of REST
 * queueing. Worse, the two expiries line up: session access tokens live 5 minutes and `CACHE_TTL_MS` is 5
 * minutes, so a tab idle for that long comes back with both expired at once and hits exactly this.
 *
 * Process-local (like `guildDataCache.ts`'s equivalent): it only needs to stop one replica racing itself,
 * and whichever fetch wins writes the shared redis entry the others would have written anyway.
 *
 * A `force: true` caller coalesces onto an already-running fetch rather than starting a second one -- an
 * in-flight fetch is by definition already hitting Discord right now, which is exactly what forcing asks
 * for; it just observes state from when that fetch started rather than from its own call.
 */
async function singleFlight<TValue>(
	inflight: Map<string, Promise<TValue>>,
	key: string,
	run: () => Promise<TValue>,
): Promise<TValue> {
	const existing = inflight.get(key);
	if (existing) {
		return existing;
	}

	const promise = (async () => {
		try {
			return await run();
		} finally {
			inflight.delete(key);
		}
	})();

	inflight.set(key, promise);
	return promise;
}

const inflightMe = new Map<string, Promise<Me>>();
const inflightScopedMe = new Map<string, Promise<Me>>();

export async function fetchMe(discordAccessToken: string, logger: Logger, force = false): Promise<Me> {
	const tokenHash = hashToken(discordAccessToken);

	if (!force) {
		const cached = await MeStore.get(tokenHash);
		if (cached) {
			return cached;
		}
	}

	return singleFlight(inflightMe, tokenHash, async () => fetchMeUncached(discordAccessToken, tokenHash, logger));
}

/**
 * The actual `/me` resolution, only ever reached through `fetchMe` above (which owns the cache read and the
 * in-flight de-duplication).
 *
 * The `/users/@me` call here is deliberately the one Discord user fetch in this service that does *not* go
 * through the shared cross-bot user cache (`util/users.ts`): it's made with the user's own OAuth token and
 * comes back with fields (`email`, `verified`, `locale`, ...) that must never land in a cache every bot and
 * every guild's dashboard reads from. Its caching is `MeStore`, keyed per session.
 */
async function fetchMeUncached(discordAccessToken: string, tokenHash: string, logger: Logger): Promise<Me> {
	logger.info('cache miss for /me');

	const start = performance.now();

	const auth = {
		prefix: 'Bearer' as const,
		token: discordAccessToken,
	};

	// Separate rate-limit buckets, so there's nothing to gain from doing these one after the other.
	const [discordUser, guildsRaw] = await Promise.all([
		discordAPIOAuth.users.getCurrent({ auth }),
		discordAPIOAuth.users.getGuilds({ with_counts: true }, { auth }),
	]);

	const instances = getAllInstances();

	const [guildsByBot, instanceGuildLists] = await Promise.all([
		promiseAllObject(
			Object.fromEntries(BOTS.map((bot) => [bot, readGuildList(bot)])) as Record<BotId, Promise<string[]>>,
		),
		// Each custom instance publishes its own `MODMAIL#<id>` guild list (`lib/data/bots.ts`) rather than
		// overwriting the public deployment's -- so "is MODMAIL installed in this guild" has to union the public
		// list with every instance's, or a partner guild would show no ModMail badge at all. `readGuildList` itself
		// unions across that deployment's own replicas.
		Promise.all(instances.map(async (instance) => readGuildList(`MODMAIL#${instance.id}`))),
	]);
	const modmailGuildIds = new Set([...(guildsByBot.MODMAIL ?? []), ...instanceGuildLists.flat()]);

	// One query for every grant this user holds, rather than one `dashboard_grants` round trip per guild below --
	// `guildsRaw` can be dozens of guilds long, and this collapses that to a single lookup.
	const grantedGuildIds = new Set(
		(
			await getContext().db<Pick<DashboardGrants, 'guildId'>[]>`
				SELECT guild_id FROM dashboard_grants WHERE user_id = ${discordUser.id}
			`
		).map((grant) => grant.guildId),
	);

	// Guest access to an AMA is independent of guild membership -- a guest configured in some session's
	// `guest_ids` might not be an OAuth member of that guild at all (see `MeGuild.amaGuestSessionIds`'s
	// doc comment). Queried once here rather than per-guild, same reasoning as `grantedGuildIds` above.
	const guestSessionsByGuild = new Map<string, number[]>();
	for (const row of await getContext().db<Pick<AmaSessions, 'guildId' | 'id'>[]>`
		SELECT id, guild_id FROM ama_sessions WHERE ${discordUser.id} = ANY(guest_ids)
	`) {
		const existing = guestSessionsByGuild.get(row.guildId);
		if (existing) {
			existing.push(row.id);
		} else {
			guestSessionsByGuild.set(row.guildId, [row.id]);
		}
	}

	// Only resolved for instances the user is actually in a guild for -- no point spending a Discord call (even
	// a redis-cached one) branding an instance this response will never mention.
	const relevantInstances = instances.filter((instance) => guildsRaw.some((guild) => guild.id === instance.guildId));
	const brandingEntries = await Promise.all(
		relevantInstances.map(async (instance): Promise<[string, Awaited<ReturnType<typeof getInstanceBranding>>]> => {
			try {
				return [instance.id, await getInstanceBranding(instance)];
			} catch (error) {
				// Best-effort, same shape as `resolveUserBestEffort` -- a partner's icon failing to resolve
				// shouldn't fail the whole `/me` response, just fall back to no icon.
				logger.warn({ err: error, instanceId: instance.id }, 'failed to resolve custom instance branding');
				return [instance.id, { iconUrl: null, label: instance.label }];
			}
		}),
	);
	const brandingByInstanceId = new Map(brandingEntries);

	const guilds: MeGuild[] = guildsRaw.map(({ id, name, icon, owner, permissions }) => {
		const instance: Instance | null = getInstanceForGuild(id);
		const branding = instance ? brandingByInstanceId.get(instance.id) : undefined;

		return {
			id,
			name,
			icon,
			meCanManage:
				grantedGuildIds.has(id) ||
				PermissionsBitField.any(
					BigInt(permissions),
					PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator,
				) ||
				owner,
			bots: BOTS.filter((bot) => (bot === 'MODMAIL' ? modmailGuildIds.has(id) : guildsByBot[bot]?.includes(id))),
			amaGuestSessionIds: guestSessionsByGuild.get(id) ?? [],
			customInstanceId: instance?.id ?? null,
			customInstanceLabel: instance?.label ?? null,
			customInstanceIconUrl: branding?.iconUrl ?? null,
		};
	});

	// A guest who isn't an OAuth member of the guild at all has no entry in `guilds` yet -- synthesize one
	// via the AMA bot's own API access (mirrors `fetchMeForScopedSession`'s membership-independent guild
	// lookup), so their dashboard guild list still shows this guild for the AMA(s) they're scoped to. No
	// custom-instance branding lookup here -- custom instances (#216) are a ModMail-only concept, and this
	// path only ever synthesizes AMA-bot guilds.
	const memberGuildIds = new Set(guilds.map((guild) => guild.id));
	const guestOnlyGuildIds = [...guestSessionsByGuild.keys()].filter((id) => !memberGuildIds.has(id));
	const guestOnlyGuilds = await Promise.all(
		guestOnlyGuildIds.map(async (guildId): Promise<MeGuild | null> => {
			try {
				const guild = await apiForGuild('AMA', guildId).guilds.get(guildId);

				return {
					id: guild.id,
					name: guild.name,
					icon: guild.icon,
					meCanManage: false,
					bots: ['AMA'],
					amaGuestSessionIds: guestSessionsByGuild.get(guildId) ?? [],
					customInstanceId: null,
					customInstanceLabel: null,
					customInstanceIconUrl: null,
				};
			} catch (error) {
				// Best-effort: if the AMA bot can no longer reach this guild (kicked, etc.), drop it from the
				// guest's guild list rather than failing the whole /me response over one bad guild.
				logger.warn({ err: error, guildId }, 'failed to resolve guest-only guild for AMA guest access');
				return null;
			}
		}),
	);
	guilds.push(...guestOnlyGuilds.filter((guild): guild is MeGuild => guild !== null));

	const me: Me = {
		id: discordUser.id,
		username: discordUser.username,
		discriminator: discordUser.discriminator,
		global_name: discordUser.global_name,
		avatar: discordUser.avatar,
		isGlobalAdmin: getContext().env.ADMINS.has(discordUser.id),
		guilds,
	};

	await MeStore.set(tokenHash, me);

	const end = performance.now();
	logger.info({ durationMs: end - start }, 'fetched /me');

	return me;
}

/**
 * Scoped-session equivalent of `fetchMe`: there's no Discord OAuth access token to call
 * `/users/@me`/`/users/@me/guilds` with, so instead this resolves identity + permissions for exactly one
 * (guildId, sub) pair via whichever ChatSift bot(s) are actually installed there, using the same
 * `GuildList`-union logic `fetchMe` uses to populate `MeGuild.bots`. `guilds` is deliberately a single-entry
 * array -- unlike a real session, a scoped session only ever authorizes one guild.
 *
 * `meCanManage` is computed with the exact same rule `fetchMe` uses below (owner, `ManageGuild`/`Administrator`,
 * or a `dashboard_grants` row) -- just sourced from a bot's view of guild membership/roles instead of the
 * user's own OAuth token, since there isn't one here. Callers (the `/v3/auth/dashboard` exchange route and
 * `isAuthed`'s scoped refresh branch) are what actually enforce this value; this function itself makes no
 * authorization decision, it can and does return `meCanManage: false`.
 *
 * Cached in `ScopedMeStore` (same TTL/shape as `MeStore`) -- unlike the old single-use grant tokens this
 * replaces, a scoped session is read repeatedly (every 5-minute access-token rotation, every dashboard page
 * load) for up to 30 minutes, so this is a real repeat-read pattern worth caching.
 */
export async function fetchMeForScopedSession(
	guildId: string,
	sub: string,
	logger: Logger,
	force = false,
): Promise<Me> {
	const cacheKey = `${guildId}:${sub}`;
	if (!force) {
		const cached = await ScopedMeStore.get(cacheKey);
		if (cached) {
			return cached;
		}
	}

	return singleFlight(inflightScopedMe, cacheKey, async () =>
		fetchMeForScopedSessionUncached(guildId, sub, cacheKey, logger),
	);
}

/**
 * The actual scoped-session resolution, only ever reached through `fetchMeForScopedSession` above -- which
 * owns the cache read and the in-flight de-duplication (see `singleFlight`; the parallel-dashboard-request
 * pile-up it exists for applies equally here, and `refreshScoped` in `middleware/isAuthed.ts` always forces).
 */
async function fetchMeForScopedSessionUncached(
	guildId: string,
	sub: string,
	cacheKey: string,
	logger: Logger,
): Promise<Me> {
	logger.info({ userId: sub, guildId }, 'cache miss for scoped dashboard session /me');

	const instances = getAllInstances();
	const [guildsByBot, instanceGuildLists] = await Promise.all([
		promiseAllObject(
			Object.fromEntries(BOTS.map((bot) => [bot, readGuildList(bot)])) as Record<BotId, Promise<string[]>>,
		),
		Promise.all(instances.map(async (instance) => readGuildList(`MODMAIL#${instance.id}`))),
	]);
	const modmailGuildIds = new Set([...(guildsByBot.MODMAIL ?? []), ...instanceGuildLists.flat()]);

	const bots = BOTS.filter((bot) =>
		bot === 'MODMAIL' ? modmailGuildIds.has(guildId) : (guildsByBot[bot]?.includes(guildId) ?? false),
	);
	if (!bots.length) {
		// No ChatSift bot has this guild in its list any more (kicked since the link was minted, most likely) --
		// nothing left that could resolve identity/permissions for it.
		throw unauthorized('no bot is installed in this guild any more');
	}

	// Any installed bot works equally well here -- the calls below are guild-membership/role reads, not
	// bot-specific actions, so there's no reason to prefer one over another the way `roundRobinAPI` does for
	// outbound call spreading.
	const bot = bots[0]!;
	const api = apiForGuild(bot, guildId);
	const instance = getInstanceForGuild(guildId);

	let discordUser: APIUser | null;
	let guild: Awaited<ReturnType<typeof api.guilds.get>>;
	let member: Awaited<ReturnType<typeof api.guilds.getMember>>;
	let roles: Awaited<ReturnType<typeof api.guilds.getRoles>>;
	let hasGrant: boolean;
	let branding: Awaited<ReturnType<typeof getInstanceBranding>> | undefined;

	try {
		[discordUser, guild, member, roles, hasGrant, branding] = await Promise.all([
			// Cached (unlike the `/users/@me` call in `fetchMe`, which never can be) -- a scoped session
			// re-resolves itself on every 5-minute rotation, and this is the same global user lookup every
			// dashboard route makes, so it may as well share their cache. `null` here is the same "Discord
			// doesn't know this user any more" signal a 404 from the other calls below carries.
			resolveDiscordUserOrNull(api, sub),
			api.guilds.get(guildId),
			api.guilds.getMember(guildId, sub),
			api.guilds.getRoles(guildId),
			getContext().db<
				Pick<DashboardGrants, 'id'>[]
			>`SELECT id FROM dashboard_grants WHERE guild_id = ${guildId} AND user_id = ${sub}`.then(
				(rows) => rows.length > 0,
			),
			// Best-effort, same as `fetchMe`'s `brandingEntries` -- a failure to resolve a partner's icon is a
			// cosmetic annotation on top of an otherwise-successful request, not a reason to fail the whole thing.
			instance
				? getInstanceBranding(instance).catch((error: unknown) => {
						logger.warn({ err: error, instanceId: instance.id }, 'failed to resolve custom instance branding');
						return { iconUrl: null, label: instance.label };
					})
				: undefined,
		]);
	} catch (error) {
		// The user/member/guild this session is minted for can 404 -- kicked from the guild, left, or the
		// account no longer exists -- between mint and use. Same "nothing left that could resolve identity for
		// this guild" outcome as the empty-`bots` branch above, so it gets the same treatment. Anything else
		// (5xx, rate limit, network) says nothing about eligibility and must not be swallowed as a 401.
		if (!isNotFoundDiscordError(error)) {
			throw error;
		}

		logger.warn({ err: error, userId: sub, guildId }, 'discord reported the user/member/guild as gone');
		throw unauthorized('could not resolve guild membership for this session');
	}

	if (!discordUser) {
		logger.warn({ userId: sub, guildId }, 'discord reported the user as gone');
		throw unauthorized('could not resolve guild membership for this session');
	}

	// `@everyone`'s permissions apply to every member and its role id always equals the guild id -- included
	// here the same way Discord's own permission resolution does, even though `guilds.getRoles` returns it
	// like any other role.
	const memberRoleIds = new Set([guildId, ...member.roles]);
	let permissionBits = 0n;
	for (const role of roles) {
		if (memberRoleIds.has(role.id)) {
			permissionBits |= BigInt(role.permissions);
		}
	}

	const meCanManage =
		guild.owner_id === sub ||
		hasGrant ||
		PermissionsBitField.any(permissionBits, PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator);

	const meGuild: MeGuild = {
		id: guild.id,
		name: guild.name,
		icon: guild.icon,
		meCanManage,
		bots,
		// Irrelevant for a scoped single-guild session -- that flow is never routed through AMA-guest-specific
		// dashboard gating.
		amaGuestSessionIds: [],
		customInstanceId: instance?.id ?? null,
		customInstanceLabel: instance?.label ?? null,
		customInstanceIconUrl: branding?.iconUrl ?? null,
	};

	const me: Me = {
		id: discordUser.id,
		username: discordUser.username,
		discriminator: discordUser.discriminator,
		global_name: discordUser.global_name,
		avatar: discordUser.avatar,
		isGlobalAdmin: false,
		guilds: [meGuild],
	};

	await ScopedMeStore.set(cacheKey, me);

	return me;
}
