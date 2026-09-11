import { Counter, Registry } from 'prom-client';

/**
 * Dedicated registry rather than prom-client's process-wide default, mirroring every other bot's
 * `lib/metrics.ts` and `services/api`'s `core/metrics.ts` (#277).
 *
 * **Collection is unconditional; only exposure is gated** (see `@chatsift/bot-core`'s `metricsServer.ts`).
 *
 * **Cardinality discipline, non-negotiable:** never label by `guild_id` or `user_id`. Every label below is
 * drawn from a closed set known at compile time.
 *
 * This process publishes `discord_guilds` for free via `bot-core`'s client, which is the number that answers
 * "how many servers is Appeals in". That is **not** the same question as "how many servers accept appeals" --
 * see docs/roadmap/09-appeals.md on why those want separate panels.
 */
export const register = new Registry();

/**
 * Decisions taken on the card (#232 P4).
 *
 * `decision` is `approved`, `denied`, `denied_silent` or `moot` -- the silent kind is its own value rather than
 * a flag, because "how much of this is invisible to appellants" is the question worth being able to ask of a
 * product that deliberately lies to some of them, and `moot` is the only one no human took (P4b: the ban was
 * lifted somewhere else and the appeal closed itself). `outcome` is `applied`, `raced` (somebody else decided
 * first, an ordinary outcome rather than an error) or `failed` (the claim was given back, which today means an
 * unban Discord refused -- the one alert-worthy value here, since every one of those is an appeal a moderator
 * believes they approved).
 */
export const appealDecisions = new Counter({
	name: 'appeals_decisions_total',
	help: 'Appeal decisions, by decision and what came of it',
	labelNames: ['decision', 'outcome'] as const,
	registers: [register],
});

/**
 * Ban-list events observed, and what came of the `appeal_ban_checks` write they prime.
 *
 * `kind` is `add` or `remove`; `outcome` is `refreshed` (a cached probe result existed and was updated),
 * `uncached` (nobody had probed that user in that guild, so there was nothing to update) or `failed`.
 *
 * The question it primarily answers is whether the `GuildModeration` intent is actually delivering: a flat zero
 * across every outcome, on a bot that is demonstrably in guilds, means the intent is off -- otherwise completely
 * silent, since the bot connects, reports its guilds, and simply never sees a ban. Splitting `refreshed` from
 * `uncached` additionally says whether the priming is doing any work, which `uncached` dominating would mean it
 * is not.
 */
export const banEvents = new Counter({
	name: 'appeals_ban_events_total',
	help: 'Ban-list gateway events observed, by kind and what came of priming the probe cache',
	labelNames: ['kind', 'outcome'] as const,
	registers: [register],
});
