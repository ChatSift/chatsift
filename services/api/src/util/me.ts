import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { BotId, GrantTokenData, Logger } from '@chatsift/backend-core';
import {
	BOTS,
	GRANT_BOTS,
	getContext,
	GuildList,
	PermissionsBitField,
	promiseAllObject,
	RedisStore,
} from '@chatsift/backend-core';
import type { DashboardGrants } from '@chatsift/db';
import type { APIUser, RESTAPIPartialCurrentUserGuild } from '@discordjs/core';
import { PermissionFlagsBits } from '@discordjs/core';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';
import { APIMapping, discordAPIOAuth } from './discordAPI.js';

export type MeGuild = Pick<RESTAPIPartialCurrentUserGuild, 'icon' | 'id' | 'name'> & {
	bots: BotId[];
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

// bin-rw has no concept of a string-literal-union field -- `bots` round-trips as a plain `string[]` -- so the
// stored shape is `Me` with that one field widened, and `fetchMe` casts back to `BotId[]` on read. Safe because
// this store only ever gets written the values `BOTS.filter(...)` below produces.
type WireMe = Omit<Me, 'guilds'> & { guilds: (Omit<MeGuild, 'bots'> & { bots: string[] })[] };

const MeStore = new RedisStore<WireMe>({
	TTL: CACHE_TTL_MS,
	// As in `channels.ts`, `DataType.String` types as non-nullable `string` even though the underlying
	// `Reader`/`Writer` already treat null and empty-string identically on the wire -- `global_name`/`avatar`/
	// `icon` really are `string | null` and round-trip correctly at runtime, the cast just corrects the type.
	recipe: createRecipe({
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
				bots: [DataType.String],
			},
		],
	}) as Recipe<WireMe>,
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
			return { ...cached, guilds: cached.guilds.map((guild) => ({ ...guild, bots: guild.bots as BotId[] })) };
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

	const guildsByBot = await promiseAllObject(
		Object.fromEntries(BOTS.map((bot) => [bot, GuildList.get(bot).then((data) => data?.guilds ?? [])])) as Record<
			BotId,
			Promise<string[]>
		>,
	);

	const guilds = await Promise.all(
		guildsRaw.map<Promise<MeGuild>>(async ({ id, name, icon, owner, permissions }) => {
			const [grant] = await getContext().db<Pick<DashboardGrants, 'id'>[]>`
				SELECT id FROM dashboard_grants WHERE guild_id = ${id} AND user_id = ${discordUser.id}
			`;
			const hasGrant = Boolean(grant);

			return {
				id,
				name,
				icon,
				meCanManage:
					hasGrant ||
					PermissionsBitField.has(
						BigInt(permissions),
						PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator,
					) ||
					owner,
				bots: BOTS.filter((bot) => guildsByBot[bot]?.includes(id)),
			};
		}),
	);

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
 */
export async function fetchMeFromGrant(grant: GrantTokenData, logger: Logger): Promise<Me> {
	logger.info({ userId: grant.sub, guildId: grant.guildId }, 'building stripped /me from grant token');

	const bot = GRANT_BOTS[grant.grant];
	const api = APIMapping[bot];

	const [discordUser, guild] = await Promise.all([api.users.get(grant.sub), api.guilds.get(grant.guildId)]);

	const meGuild: MeGuild = {
		id: guild.id,
		name: guild.name,
		icon: guild.icon,
		// The grant token itself is the authorization for this one scoped action -- there's no broader
		// "can manage this guild" question to ask here the way there is for a real session.
		// The authentication middleware gurantees this via its guards.
		meCanManage: true,
		bots: [bot],
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
