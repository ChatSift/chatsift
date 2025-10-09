import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers';
import type { BotId } from '@chatsift/backend-core';
import { BOTS, GlobalCaches, PermissionsBitField, promiseAllObject } from '@chatsift/backend-core';
import type { APIUser, RESTAPIPartialCurrentUserGuild } from '@discordjs/core';
import { PermissionFlagsBits } from '@discordjs/core';
import { nanoid } from 'nanoid';
import { context } from '../context.js';
import { discordAPIOAuth } from './discordAPI.js';

export type MeGuild = Pick<RESTAPIPartialCurrentUserGuild, 'icon' | 'id' | 'name'> & {
	approximate_member_count?: number;
	approximate_presence_count?: number;
	bots: BotId[];
	meCanManage: boolean;
};
export type Me = APIUser & { guilds: MeGuild[]; isGlobalAdmin: boolean };

// TODO(DD): Should probably move this to redis
const CACHE = new Map<string, Me>();
const CACHE_TIMEOUTS = new Map<string, NodeJS.Timeout>();
const CACHE_TTL = 5 * 60 * 1_000; // 5 minutes

export async function fetchMe(discordAccessToken: string, force = false): Promise<Me> {
	if (CACHE.has(discordAccessToken) && !force) {
		return CACHE.get(discordAccessToken)!;
	}

	const track = nanoid(10);
	context.logger.info({ track }, 'cache miss for /me');

	const start = performance.now();

	const auth = {
		prefix: 'Bearer' as const,
		token: discordAccessToken,
	};

	const discordUser = await discordAPIOAuth.users.getCurrent({ auth });
	const guildsRaw = await discordAPIOAuth.users.getGuilds({ with_counts: true }, { auth });

	const guildsByBot = await promiseAllObject(
		Object.fromEntries(
			BOTS.map((bot) => [
				bot,
				context.redis
					.get(GlobalCaches.GuildList.key(bot))
					.then((data) => (data ? GlobalCaches.GuildList.recipe.decode(data).guilds : [])),
			]),
		) as Record<BotId, Promise<string[]>>,
	);

	const guilds = guildsRaw.map<MeGuild>(
		({ id, name, icon, owner, permissions, approximate_member_count, approximate_presence_count }) => {
			const guild: MeGuild = {
				id,
				name,
				icon,
				meCanManage:
					PermissionsBitField.has(
						BigInt(permissions),
						PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator,
					) || owner,
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
	);

	const me: Me = {
		...discordUser,
		isGlobalAdmin: context.env.ADMINS.has(discordUser.id),
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
	context.logger.info({ track, durationMs: end - start }, 'fetched /me');

	return me;
}
