import { getContext } from '@chatsift/backend-core';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';

export interface GuildInfo {
	iconURL: string | undefined;
	name: string;
}

/**
 * Used for the "\{guild name\} Team" author (name + icon) on anon replies and ticket greetings —
 * low enough call frequency (once per ticket open, occasionally per anon reply) that an uncached REST call is fine,
 * no need for a guild-info cache layer.
 */
export async function getGuildInfo(guildId: string): Promise<GuildInfo> {
	const guild = await getContext().service.client.api.guilds.get(guildId);
	return {
		name: guild.name,
		iconURL: guild.icon ? `${RouteBases.cdn}${CDNRoutes.guildIcon(guildId, guild.icon, ImageFormat.PNG)}` : undefined,
	};
}

/**
 * Default matches `TemplatePlaceholdersHint`'s placeholder in the dashboard's config form.
 */
const DEFAULT_ANON_REPLY_LABEL = '{{ guildName }} Team';

/**
 * The dashboard-configurable author label template for anon replies (`guild_settings.anon_reply_label`,
 * see `lib/relay.ts`) — falls back to the same default shown as the field's placeholder rather than
 * baking a literal default into the column, so changing the default later needs no data migration.
 */
export async function getAnonReplyLabelTemplate(guildId: string): Promise<string> {
	const [row] = await getContext().db<[{ anonReplyLabel: string | null }]>`
		SELECT anon_reply_label FROM guild_settings WHERE guild_id = ${guildId}
	`;

	return row?.anonReplyLabel ?? DEFAULT_ANON_REPLY_LABEL;
}
