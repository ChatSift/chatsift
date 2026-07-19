import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
import type { BotId, GrantTokenData, Logger } from '@chatsift/backend-core';
import { BOTS, getContext, GuildList, PermissionsBitField, promiseAllObject } from '@chatsift/backend-core';
import type { DashboardGrants } from '@chatsift/db';
import type { APIUser, RESTAPIPartialCurrentUserGuild } from '@discordjs/core';
import { PermissionFlagsBits } from '@discordjs/core';
import { discordAPIAma, discordAPIOAuth } from './discordAPI.js';

export type MeGuild = Pick<
	RESTAPIPartialCurrentUserGuild,
	'approximate_member_count' | 'approximate_presence_count' | 'icon' | 'id' | 'name'
> & {
	bots: BotId[];
	meCanManage: boolean;
};
export type Me = APIUser & { guilds: MeGuild[]; isGlobalAdmin: boolean };

// TODO(DD): Should probably move this to redis
const CACHE = new Map<string, Me>();
const CACHE_TIMEOUTS = new Map<string, NodeJS.Timeout>();
const CACHE_TTL = 5 * 60 * 1_000; // 5 minutes

export function clearCache() {
	CACHE.clear();
	for (const timeout of CACHE_TIMEOUTS.values()) {
		clearTimeout(timeout);
	}

	CACHE_TIMEOUTS.clear();
}

export async function fetchMe(discordAccessToken: string, logger: Logger, force = false): Promise<Me> {
	if (CACHE.has(discordAccessToken) && !force) {
		return CACHE.get(discordAccessToken)!;
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
		guildsRaw.map<Promise<MeGuild>>(
			async ({ id, name, icon, owner, permissions, approximate_member_count, approximate_presence_count }) => {
				const [grant] = await getContext().db<Pick<DashboardGrants, 'id'>[]>`
					SELECT id FROM dashboard_grants WHERE guild_id = ${id} AND user_id = ${discordUser.id}
				`;
				const hasGrant = Boolean(grant);

				const guild: MeGuild = {
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

				if (approximate_member_count !== undefined) {
					guild.approximate_member_count = approximate_member_count;
				}

				if (approximate_presence_count !== undefined) {
					guild.approximate_presence_count = approximate_presence_count;
				}

				return guild;
			},
		),
	);

	const me: Me = {
		...discordUser,
		isGlobalAdmin: getContext().env.ADMINS.has(discordUser.id),
		guilds,
	};

	CACHE.set(discordAccessToken, me);
	if (CACHE_TIMEOUTS.has(discordAccessToken)) {
		const timeout = CACHE_TIMEOUTS.get(discordAccessToken)!;
		timeout.refresh();
	} else {
		const timeout = setTimeout(() => {
			CACHE.delete(discordAccessToken);
			CACHE_TIMEOUTS.delete(discordAccessToken);
		}, CACHE_TTL).unref();

		CACHE_TIMEOUTS.set(discordAccessToken, timeout);
	}

	const end = performance.now();
	logger.info({ durationMs: end - start }, 'fetched /me');

	return me;
}

/**
 * Grant-token equivalent of `fetchMe`: there's no Discord OAuth access token to call `/users/@me`/`/users/@me/guilds`
 * with, so instead it uses the AMA bot's own REST client (already a member of the grant's guild, or the grant
 * couldn't have been minted) to fetch just the acting user and the one guild the grant is scoped to. `guilds` is
 * deliberately a single-entry array -- unlike a real session, a grant token only ever authorizes one guild.
 */
export async function fetchMeFromGrant(grant: GrantTokenData, logger: Logger): Promise<Me> {
	logger.info({ userId: grant.sub, guildId: grant.guildId }, 'building stripped /me from grant token');

	const [discordUser, guild] = await Promise.all([
		discordAPIAma.users.get(grant.sub),
		discordAPIAma.guilds.get(grant.guildId),
	]);

	const meGuild: MeGuild = {
		id: guild.id,
		name: guild.name,
		icon: guild.icon,
		// The grant token itself is the authorization for this one scoped action -- there's no broader
		// "can manage this guild" question to ask here the way there is for a real session.
		// The authentication middleware gurantees this via its guards.
		meCanManage: true,
		// The grant may need to include this in the future.
		bots: ['AMA'],
	};

	return {
		...discordUser,
		isGlobalAdmin: false,
		guilds: [meGuild],
	};
}
