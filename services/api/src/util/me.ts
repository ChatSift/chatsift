import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { BotId, GrantTokenData, Instance, Logger } from '@chatsift/backend-core';
import {
	BOTS,
	GRANT_BOTS,
	getAllInstances,
	getContext,
	getInstanceForGuild,
	GuildList,
	PermissionsBitField,
	promiseAllObject,
	RedisStore,
} from '@chatsift/backend-core';
import type { AmaSessions, DashboardGrants } from '@chatsift/db';
import type { APIUser, RESTAPIPartialCurrentUserGuild } from '@discordjs/core';
import { PermissionFlagsBits } from '@discordjs/core';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType, stringLiteral } from 'bin-rw';
import { apiForGuild, discordAPIOAuth } from './discordAPI.js';
import { getInstanceBranding } from './discordApplication.js';

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

const MeStore = new RedisStore<Me>({
	TTL: CACHE_TTL_MS,
	// bin-rw's own inferred type is wider than `Me`: every `DataType.String`/`stringLiteral` field decodes as
	// `string | null` (or `BotId | null` for `bots`), whereas `global_name`/`avatar`/`icon` are the only fields
	// that are genuinely nullable here -- the cast corrects that.
	recipe: createRecipe(
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
	) as Recipe<Me>,
	// Hashed rather than keyed by the raw access token -- unlike the in-memory `Map` this replaced, this value is
	// persisted in redis (visible to anything with redis access via KEYS/MONITOR/RDB dumps), so the key itself
	// shouldn't double as a live OAuth credential.
	makeKey: (tokenHash: string) => `me:${tokenHash}`,
	storeOld: false,
});

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export async function fetchMe(discordAccessToken: string, logger: Logger, force = false): Promise<Me> {
	const tokenHash = hashToken(discordAccessToken);

	if (!force) {
		const cached = await MeStore.get(tokenHash);
		if (cached) {
			return cached;
		}
	}

	logger.info('cache miss for /me');

	const start = performance.now();

	const auth = {
		prefix: 'Bearer' as const,
		token: discordAccessToken,
	};

	const discordUser = await discordAPIOAuth.users.getCurrent({ auth });
	const guildsRaw = await discordAPIOAuth.users.getGuilds({ with_counts: true }, { auth });

	const instances = getAllInstances();

	const [guildsByBot, instanceGuildLists] = await Promise.all([
		promiseAllObject(
			Object.fromEntries(BOTS.map((bot) => [bot, GuildList.get(bot).then((data) => data?.guilds ?? [])])) as Record<
				BotId,
				Promise<string[]>
			>,
		),
		// Each custom instance publishes its own `bot:MODMAIL#<id>` guild list (`lib/data/bots.ts`) rather than
		// overwriting the public deployment's `bot:MODMAIL` -- so "is MODMAIL installed in this guild" has to
		// union the public list with every instance's, or a partner guild would show no ModMail badge at all.
		Promise.all(
			instances.map(async (instance) => GuildList.get(`MODMAIL#${instance.id}`).then((data) => data?.guilds ?? [])),
		),
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
				PermissionsBitField.has(
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
	// via the AMA bot's own API access (mirrors `fetchMeFromGrant`'s membership-independent guild lookup),
	// so their dashboard guild list still shows this guild for the AMA(s) they're scoped to. No custom-
	// instance branding lookup here -- custom instances (#216) are a ModMail-only concept, and this path
	// only ever synthesizes AMA-bot guilds.
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
 * Grant-token equivalent of `fetchMe`: there's no Discord OAuth access token to call `/users/@me`/`/users/@me/guilds`
 * with, so instead it uses whichever bot's grant this is (`GRANT_BOTS`, since the grant's own guild is guaranteed
 * to already have that bot installed, or the grant couldn't have been minted) to fetch just the acting user and the
 * one guild the grant is scoped to. `guilds` is deliberately a single-entry array -- unlike a real session, a grant
 * token only ever authorizes one guild. Not cached (unlike `fetchMe`) -- a grant is single-use already, so there's
 * no repeat-read pattern here worth trading staleness for.
 *
 * Resolved via `apiForGuild`, not the raw `GRANT_BOTS`/`APIMapping` pairing -- several ModMail grants
 * (`MODMAIL_SNIPPET_CREATE`/`MODMAIL_CONFIG_UPDATE`/`MODMAIL_BLOCKS_READ`) are minted by a command running on
 * whichever bot currently owns `grant.guildId`, which for a partner guild is the custom instance, not the
 * public deployment -- the public token has no access there at all.
 */
export async function fetchMeFromGrant(grant: GrantTokenData, logger: Logger): Promise<Me> {
	logger.info({ userId: grant.sub, guildId: grant.guildId }, 'building stripped /me from grant token');

	const bot = GRANT_BOTS[grant.grant];
	const api = apiForGuild(bot, grant.guildId);
	const instance = getInstanceForGuild(grant.guildId);

	const [discordUser, guild, branding] = await Promise.all([
		api.users.get(grant.sub),
		api.guilds.get(grant.guildId),
		// Best-effort, same as `fetchMe`'s `brandingEntries` -- a failure to resolve a partner's icon is a
		// cosmetic annotation on top of an otherwise-successful grant-authed request, not a reason to fail
		// the whole thing (this ran inside the same `Promise.all` as the two calls above, so an unguarded
		// rejection here would have failed those too).
		instance
			? getInstanceBranding(instance).catch((error: unknown) => {
					logger.warn({ err: error, instanceId: instance.id }, 'failed to resolve custom instance branding');
					return { iconUrl: null, label: instance.label };
				})
			: undefined,
	]);

	const meGuild: MeGuild = {
		id: guild.id,
		name: guild.name,
		icon: guild.icon,
		// The grant token itself is the authorization for this one scoped action -- there's no broader
		// "can manage this guild" question to ask here the way there is for a real session.
		// The authentication middleware gurantees this via its guards.
		meCanManage: true,
		bots: [bot],
		// Irrelevant for a grant-authed single-guild session -- that flow is already scoped to one action
		// via the grant itself, never routed through AMA-guest-specific dashboard gating.
		amaGuestSessionIds: [],
		customInstanceId: instance?.id ?? null,
		customInstanceLabel: instance?.label ?? null,
		customInstanceIconUrl: branding?.iconUrl ?? null,
	};

	return {
		id: discordUser.id,
		username: discordUser.username,
		discriminator: discordUser.discriminator,
		global_name: discordUser.global_name,
		avatar: discordUser.avatar,
		isGlobalAdmin: false,
		guilds: [meGuild],
	};
}
