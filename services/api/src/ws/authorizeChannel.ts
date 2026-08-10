import type { WsTicketData } from '@chatsift/backend-core';

/**
 * Decides whether a ticket may subscribe to a channel. Two independent paths, both plain in-memory checks
 * against claims resolved once at mint time (`routes/ws/getTicket.ts`, `routes/ama/questions/publicWsTicket.ts`)
 * -- nothing here touches Discord or the DB, since this runs on every `subscribe` frame:
 *
 * 1. The exact-match allowlist (`WsTicketData.channels`), for access that isn't a guild-manager grant at all --
 *    AMA guests and the unauthenticated public answers page. See that field's doc comment.
 * 2. The guild-wide grant: a guild-scoped channel is `<domain>:<guildId>:<...>` (see `@chatsift/core`'s
 *    `realtimeChannels.ts`), so a manager of that guild -- or a global admin -- gets every channel under it
 *    without each domain needing its own authorization rule.
 *
 * The three-segment minimum in path 2 is load-bearing, not just a parse guard. `amaPublicAnswersChannel` is
 * deliberately guildless (`ama-public:<amaId>`, two segments) so it can *only* be reached through path 1 --
 * without the length check its ama id would land in the guild-id position, and a manager whose `adminGuilds`
 * contained a matching string would inherit it. Snowflakes and small serial ids realistically never collide,
 * but authorization shouldn't be resting on that.
 */
export function isAuthorizedForChannel(ticket: WsTicketData, channel: string): boolean {
	if (ticket.channels.includes(channel)) {
		return true;
	}

	const segments = channel.split(':');
	if (segments.length < 3) {
		return false;
	}

	const guildId = segments[1];
	if (!guildId) {
		return false;
	}

	return ticket.isAdmin || ticket.adminGuilds.includes(guildId);
}
