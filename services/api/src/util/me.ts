import { setTimeout } from 'node:timers';
import { PermissionsBitField } from '@chatsift/backend-core';
import type { APIUser, RESTAPIPartialCurrentUserGuild } from '@discordjs/core';
import { PermissionFlagsBits } from '@discordjs/core';
import { context } from '../context.js';
import { discordAPIOAuth } from './discordAPI.js';

// TODO: Proper bots type
export type MeGuild = Pick<RESTAPIPartialCurrentUserGuild, 'icon' | 'id' | 'name'> & {
	bots: string[];
	meCanManage: boolean;
};
export type Me = APIUser & { guilds: MeGuild[]; isGlobalAdmin: boolean };

const CACHE = new Map<string, Me>();
const CACHE_TIMEOUTS = new Map<string, NodeJS.Timeout>();

export async function fetchMe(discordAccessToken: string, force = false): Promise<Me> {
	if (CACHE.has(discordAccessToken) && !force) {
		return CACHE.get(discordAccessToken)!;
	}

	const auth = {
		prefix: 'Bearer' as const,
		token: discordAccessToken,
	};

	const discordUser = await discordAPIOAuth.users.getCurrent({ auth });
	const guildsRaw = await discordAPIOAuth.users.getGuilds({}, { auth });

	const guilds = guildsRaw.map<MeGuild>(({ id, name, icon, owner, permissions }) => ({
		id,
		name,
		icon,
		owner,
		permissions,
		meCanManage:
			PermissionsBitField.has(
				BigInt(permissions),
				PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator,
			) || owner,
		bots: [],
	}));

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
		const timeout = setTimeout(
			() => {
				CACHE.delete(discordAccessToken);
				CACHE_TIMEOUTS.delete(discordAccessToken);
			},
			5 * 60 * 1_000,
		).unref();

		CACHE_TIMEOUTS.set(discordAccessToken, timeout);
	}

	return me;
}
