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
 * Ban-list events observed, and what came of the `appeal_ban_checks` write they prime.
 *
 * `kind` is `add` or `remove`; `outcome` is `primed` or `failed`. Deliberately thin, because this counter's job
 * is to answer one diagnostic question: is the `GuildModeration` intent actually delivering? A flat zero here
 * on a bot that is demonstrably in guilds means the intent is off, which is otherwise completely silent -- the
 * bot connects, reports guilds, and simply never sees a ban.
 */
export const banEvents = new Counter({
	name: 'appeals_ban_events_total',
	help: 'Ban-list gateway events observed, by kind and what came of priming the probe cache',
	labelNames: ['kind', 'outcome'] as const,
	registers: [register],
});
