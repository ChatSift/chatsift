import type { MeGuild, MeResponse } from '@/api/routes/auth';
import { useMe } from '@/api/routes/auth';

export interface GuildAccess {
	/**
	 * True for a global admin or anyone with `meCanManage` on this guild -- the "real" manager check.
	 */
	readonly canManage: boolean;
	/**
	 * The resolved guild entry from `me.guilds`, or `undefined` if not found (not yet loaded, or no access at all).
	 */
	readonly guild: MeGuild | undefined;
	/**
	 * True when the viewer isn't a manager but is listed as a guest on at least one AMA session in this
	 * guild (`guild.amaGuestSessionIds`) -- the scoped, AMA-only access tier. `guild` can be a
	 * non-member-synthesized entry here (see `services/api`'s `fetchMe` guest-guild synthesis), so this
	 * is deliberately independent of Discord guild membership.
	 */
	readonly isAmaGuestOnly: boolean;
}

/**
 * Pure derivation of a guild's access tier from an already-loaded `Me` -- shared by every gate/redirect
 * that needs to tell "full manager" apart from "AMA-guest-only" apart from "no access at all"
 * (`NavGate.tsx`, `GuildNav.tsx`, the guild overview page, `AMADetails.tsx`, `AMASessionsList.tsx`), so
 * that three-way check doesn't drift into slightly different re-implementations at each call site.
 * Exported separately from the `useGuildAccess` hook below for call sites that already have `me` from
 * their own `useMe()` call (e.g. `NavGateCheck`) and shouldn't need a second one just for this.
 */
export function resolveGuildAccess(me: MeResponse | null | undefined, guildId: string | undefined): GuildAccess {
	const guild = me?.guilds.find((g) => g.id === guildId);
	const canManage = Boolean(me?.isGlobalAdmin || guild?.meCanManage);
	const isAmaGuestOnly = !canManage && guild !== undefined && guild.amaGuestSessionIds.length > 0;

	return { guild, canManage, isAmaGuestOnly };
}

/**
 * Hook form of `resolveGuildAccess` for components that don't already have `me` loaded themselves.
 */
export function useGuildAccess(guildId: string | undefined): GuildAccess {
	const { data: me } = useMe();
	return resolveGuildAccess(me, guildId);
}
