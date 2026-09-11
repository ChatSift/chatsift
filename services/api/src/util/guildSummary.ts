import type { BotId } from '@chatsift/backend-core';
import type { API } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';
import { createCachedGuildFetcher } from './guildDataCache.js';

export interface GuildSummary {
	iconUrl: string | null;
	id: string;
	name: string;
	/**
	 * `discord.gg/<code>`, or `null` for a guild that has no vanity URL (or has never had the boost level for
	 * one). Comes free with the same `GET /guilds/{id}` this already makes -- `/admin`'s custom-instance lead
	 * list (#216) shows it, since it is the fastest way to actually reach a server you were asked to look at.
	 */
	vanityUrlCode: string | null;
}

async function fetchGuildSummaryRaw(guildId: string, api: API): Promise<GuildSummary> {
	const guild = await api.guilds.get(guildId);

	return {
		id: guild.id,
		name: guild.name,
		iconUrl: guild.icon ? `${RouteBases.cdn}${CDNRoutes.guildIcon(guild.id, guild.icon, ImageFormat.PNG)}` : null,
		vanityUrlCode: guild.vanity_url_code ?? null,
	};
}

const summaryFetcher = createCachedGuildFetcher(
	'guildsummary',
	// bin-rw decodes every string field as nullable, which is wider than `GuildSummary` -- `id`/`name` are
	// always present on a guild Discord answered for at all. The cast corrects that, same as `roles.ts`.
	createRecipe(
		{
			items: { id: DataType.String, name: DataType.String, iconUrl: DataType.String, vanityUrlCode: DataType.String },
		},
		{ versioned: true },
	) as Recipe<{ items: GuildSummary }>,
	fetchGuildSummaryRaw,
);

/**
 * A guild's name and icon, for rendering it to somebody who is not in it -- `unban.app` showing an appellant
 * which server they are about to appeal to (#232 P3).
 *
 * `null` means the bot cannot see the guild at all (403/404, mapped by `createCachedGuildFetcher`), which for an
 * appeals-enabled guild means the Appeals bot was removed after setup. Callers must render that as "this server
 * is not accepting appeals right now" rather than as an error page: it is somebody else's misconfiguration, and
 * the appellant can do nothing about it either way.
 */
export async function fetchGuildSummary(guildId: string, botId: BotId, force = false): Promise<GuildSummary | null> {
	return summaryFetcher.fetch(guildId, botId, force);
}
