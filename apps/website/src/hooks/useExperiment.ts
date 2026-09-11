import { useGuildAccess } from './useGuildAccess';

/**
 * Whether an experiment gate is on for this guild, read off `MeGuild.experiments` -- so a gated control can be
 * hidden rather than rendered into a 403.
 *
 * No callers right now: `ama-qol` (#366) was the only gate the dashboard ever checked and it has since rolled
 * out to 100%. Kept because it is the client half of machinery that is otherwise still wired end to end (the
 * `/admin` console, the `/v3/experiments` CRUD, and the `experiments` field the API already puts on every
 * `MeGuild`), and the next gated control needs exactly this and nothing else.
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
