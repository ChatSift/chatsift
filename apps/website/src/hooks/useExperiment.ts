import { useGuildAccess } from './useGuildAccess';

/**
 * Whether an experiment gate (`@chatsift/core`'s `experimentNames.ts`) is on for this guild, read off
 * `MeGuild.experiments` -- so a gated control can be hidden rather than rendered into a 403.
 *
 * Deliberately **not** `GET /v3/guilds/:guildId`, where a per-guild flag would otherwise belong: that route is
 * hard manager-only and `useGuildInfo` skips it entirely for an AMA guest, who would then see every gated AMA
 * control hidden regardless of the gate. `me.guilds` reaches guests too (their entry is synthesized server-side
 * when they aren't a Discord member at all).
 *
 * Advisory, never a security boundary -- the API re-checks every gated write. It also reads `false` while `me`
 * is still loading and lags a gate change by the `Me` cache's own TTL, both of which err towards hiding a
 * control that is in fact available, which is the harmless direction.
 */
export function useExperiment(guildId: string | undefined, name: string): boolean {
	const { guild } = useGuildAccess(guildId);
	return guild?.experiments.includes(name) ?? false;
}
