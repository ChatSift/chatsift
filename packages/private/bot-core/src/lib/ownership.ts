/**
 * Maps a guild id to the label of whichever deployment actually owns it, or `null` if this
 * deployment owns it (or ownership isn't a concept worth checking, e.g. no guild context at all).
 */
export type GuildOwnershipFilter = (guildId: string) => string | null;

let guildOwnershipFilter: GuildOwnershipFilter | null = null;

/**
 * Opt-in hook for a service where more than one deployment can own a guild (currently only
 * services/modmail-bot, see docs/roadmap/08-modmail-custom-instances.md) -- a service with a single
 * global deployment (services/ama-bot) never calls this, so `resolveForeignOwnerLabel` stays a no-op
 * there. Call once at boot, before the gateway connects.
 */
export function setGuildOwnershipFilter(filter: GuildOwnershipFilter): void {
	guildOwnershipFilter = filter;
}

/**
 * `null` if the interaction should be dispatched as normal (no filter registered, no guild context,
 * or this deployment owns the guild); otherwise the label to tell the user which deployment actually
 * owns it, instead of acting on shared rows on its behalf.
 */
export function resolveForeignOwnerLabel(guildId: string | undefined): string | null {
	if (!guildOwnershipFilter || !guildId) {
		return null;
	}

	return guildOwnershipFilter(guildId);
}
