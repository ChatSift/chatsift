import { Counter, Registry } from 'prom-client';

/**
 * Dedicated registry rather than prom-client's process-wide default, mirroring `services/api`'s
 * `core/metrics.ts` (#277) -- the scrape output stays exactly this taxonomy, with no
 * `collectDefaultMetrics()` riding along implicitly.
 *
 * **Collection is unconditional; only exposure is gated** (see `metricsServer.ts`). Every counter here is
 * incremented in dev too: a mislabelled or never-incremented metric that only runs in production is a bug you
 * find in production, and the cost of being wrong is an in-memory add.
 *
 * **Cardinality discipline, non-negotiable:** never label by `guild_id`, `user_id`, `channel_id`,
 * `message_id`, or matched content. Every label below is drawn from a closed set known at compile time. This
 * is the same rule the API's metrics module states about route patterns versus resolved URLs, and it's the one
 * mistake that turns a metrics endpoint into an outage.
 *
 * The taxonomy in docs/roadmap/11-automoderator-port.md is the full target. Only the metrics that P0 code
 * actually writes to live here -- a counter no code path increments is indistinguishable from a broken
 * feature on a dashboard, so each phase adds its own rather than all of them landing dead up front.
 */
export const register = new Registry();

/**
 * `action` is what was done to a member or message; `source` is what decided it. Both closed sets.
 * `dry_run` is a label rather than a separate metric so a panel can show intent and enforcement on one axis.
 *
 * Counts actions that actually *happened*: in live mode it is incremented only once Discord has accepted the
 * call. A rejected call lands in `automoderator_discord_errors_total` instead, so "we banned N people" never
 * silently includes the ones Discord refused.
 */
export const moderationActions = new Counter({
	name: 'automoderator_moderation_actions_total',
	help: 'Moderation actions taken, by action, deciding source, and whether they were suppressed',
	labelNames: ['action', 'source', 'dry_run'] as const,
	registers: [register],
});

/**
 * Native `AUTO_MODERATION_ACTION_EXECUTION` intake. **Flat at zero for a guild that has banword policies
 * configured is the port's most likely silent failure** -- it means either the guild has no native keyword
 * rules or the `AutoModerationExecution` intent isn't granted. `matched` distinguishes an event carrying a
 * usable `matched_keyword` from one that doesn't, which is the assumption feature 01's whole design rests on.
 */
export const automodEvents = new Counter({
	name: 'automoderator_automod_events_total',
	help: "Discord AutoMod action executions received, by the rule's action type and whether a keyword was matched",
	labelNames: ['action_type', 'matched'] as const,
	registers: [register],
});

/**
 * Should always be zero in production. Non-zero there means a guild -- or the deployment -- has dry-run on
 * when it shouldn't, and the actions it names did not actually happen.
 */
export const dryRunSuppressions = new Counter({
	name: 'automoderator_dry_run_suppressions_total',
	help: 'Side effects suppressed because dry-run was in effect',
	labelNames: ['action'] as const,
	registers: [register],
});

/**
 * Cases filed, by action and by what decided them. Distinct from `moderationActions` on purpose: a warn files
 * a case and takes no Discord action, an observed manual ban files a case for an action Discord already took,
 * and a dry-run files a case for an action that didn't happen. "How much moderation is this guild doing" and
 * "how many Discord calls did we make" are different questions and this is the first one.
 */
export const casesCreated = new Counter({
	name: 'automoderator_cases_created_total',
	help: 'Cases filed, by action and deciding source',
	labelNames: ['action', 'source'] as const,
	registers: [register],
});

/**
 * Webhook delivery health for the log channels. `result="failed"` climbing is usually a deleted log channel
 * rather than an outage -- the dispatcher self-heals by dropping the row, so a spike here is followed by
 * silence until someone reconfigures the channel, which is exactly the failure worth alerting on.
 */
export const logDispatch = new Counter({
	name: 'automoderator_log_dispatch_total',
	help: 'Log webhook deliveries, by log type and result',
	labelNames: ['log_type', 'result'] as const,
	registers: [register],
});

/**
 * `route_class` is a coarse bucket (`member`, `message`, `user`, `webhook`), never a resolved route -- a
 * per-URL label would be per-guild cardinality by another name. Written by the `ActionExecutor` when a
 * side-effecting call is rejected.
 */
export const discordErrors = new Counter({
	name: 'automoderator_discord_errors_total',
	help: 'Failed Discord API calls, by HTTP status and coarse route class',
	labelNames: ['status', 'route_class'] as const,
	registers: [register],
});
