import { Counter, Histogram, Registry } from 'prom-client';

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
 *
 * Counts actions that actually *happened*: it is incremented only once Discord has accepted the call. A
 * rejected call lands in `automoderator_discord_errors_total` instead, so "we banned N people" never silently
 * includes the ones Discord refused.
 *
 * **Bot-process only**, for the same reason `automoderator_reports_total` is bot-intake only: `services/api`
 * writes some of the same Discord objects from the dashboard -- the report card (`reports/reportCard.ts`), the
 * mod-log embed when a case is edited (`cases/caseLog.ts`), report prompts, and the log webhooks themselves --
 * and it has its own registry. So `action="message"` and `action="webhook"` are undercounts of everything this
 * product posts, not totals. Closing that means a domain counter in the API's registry, which is a decision
 * about that registry's scope (deliberately per-route for #277) rather than about this metric.
 */
export const moderationActions = new Counter({
	name: 'automoderator_moderation_actions_total',
	help: 'Moderation actions taken, by action and deciding source',
	labelNames: ['action', 'source'] as const,
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
 * Cases filed, by action and by what decided them. Distinct from `moderationActions` on purpose: a warn files
 * a case and takes no Discord action, and an observed manual ban files a case for an action Discord already
 * took. "How much moderation is this guild doing" and "how many Discord calls did we make" are different
 * questions and this is the first one.
 */
export const casesCreated = new Counter({
	name: 'automoderator_cases_created_total',
	help: 'Cases filed, by action and deciding source',
	labelNames: ['action', 'source'] as const,
	registers: [register],
});

/**
 * Report queue throughput (P3). `state` is the *transition* that happened, not the row's current value:
 * `filed` counts reports opened, `joined` counts a second reporter agreeing with an existing one,
 * `dismissed`/`actioned` count resolutions, and `restored` counts a dismissal being taken back. `filed`
 * climbing with neither resolution following it is the failure worth watching -- it means a guild's queue is
 * filling up and nobody is reading it.
 *
 * **This counter is bot-intake only.** DM reports (P3b) are filed by `services/api`, which has its own
 * registry -- deliberately scoped to per-route HTTP metrics for #277 -- so they never reach `filed` or
 * `joined` here. Their *resolutions* do count, because those go through this bot's card buttons like any
 * other. So `dismissed + actioned` can legitimately exceed `filed` on a deployment with DM reporting turned
 * on, and neither number is a total of all reports. Fixing that means putting a domain counter in the API's
 * registry, which is a decision about that registry's scope rather than about this metric.
 */
export const reportsTotal = new Counter({
	name: 'automoderator_reports_total',
	help: 'Report queue transitions, by what happened',
	labelNames: ['state'] as const,
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
 * Scheduler throughput (P2). There is no task table to draw `type` from -- P2 settled on the case row *being*
 * the schedule -- so the three values are the three sweeps that run on the timer: `expiry` (lifting a due
 * tempban), `auto_pardon` and `trigger_decay`. "Did the scheduler tick" is the question all three answer.
 *
 * `result` is only ever `ok` or `failed`, and there is deliberately no third "gave up" value: an expiry that
 * keeps failing is retried every tick forever, because abandoning one turns a temporary ban into a permanent
 * one. So `failed` climbing without `ok` following it is a stuck row, not a lost one.
 */
export const schedulerTasks = new Counter({
	name: 'automoderator_scheduler_tasks_total',
	help: 'Scheduled work run, by type and result',
	labelNames: ['type', 'result'] as const,
	registers: [register],
});

/**
 * How late a task ran: `run_at` to actually running. **Climbing means tempbans are not expiring**, which
 * surfaces as "why is this user still banned" long before anyone thinks to look at a bot.
 *
 * Buckets run out to an hour because the failure worth seeing is a loop that has stopped, not a loop that is
 * a second slow -- with the default buckets (top of 10s) a wedged scheduler and a healthy one both read as
 * `+Inf` and the panel says nothing.
 */
export const schedulerLag = new Histogram({
	name: 'automoderator_scheduler_lag_seconds',
	help: 'Delay between a task being due and it running',
	labelNames: ['type'] as const,
	buckets: [1, 5, 15, 30, 60, 300, 900, 3_600],
	registers: [register],
});

/**
 * Feature-level intake, from the taxonomy in docs/roadmap/11-automoderator-port.md -- "is feature N working in
 * prod" answerable without reading logs. Written by the observers P4 added, which is the first code here with a
 * meaningful `skipped` (an exempt channel, a message that was never cached) as opposed to a plain success.
 *
 * `applied` means the log was built and handed to the dispatcher, *not* that Discord accepted it: delivery is
 * `automoderator_log_dispatch_total`'s job. Splitting them is what keeps "the observer decided to log this"
 * separable from "the webhook worked", which are different outages with different fixes.
 */
export const featureInvocations = new Counter({
	name: 'automoderator_feature_invocations_total',
	help: 'Feature entry points reached, by feature and what came of it',
	labelNames: ['feature', 'outcome'] as const,
	registers: [register],
});

/**
 * Message cache hit rate (P4): whether a delete or edit arrived with the original still in redis to describe.
 *
 * **This is retention pressure, not intent health** -- corrected at P7, where the claim it used to carry (that
 * flat-zero `hit` is how a missing `MessageContent` intent shows up) turned out to be unreachable twice over.
 * `MessageContent` is in the IDENTIFY (`bin.ts`), so an application without it is refused the gateway and the
 * bot never boots at all; and even granting the intent were somehow absent, Discord sends `content: ""` rather
 * than omitting it, `isLoggableMessage` accepts an empty string, and every lookup would be a *hit* on an empty
 * message. Nothing about a `hit`/`miss` split can see that failure.
 *
 * What a climbing `miss` rate does mean is that deletes are reaching further back than the cache keeps: past
 * `MESSAGE_CACHE_TTL_MS`, or past `MESSAGE_CACHE_MAX_PER_CHANNEL` in a channel busy enough to have evicted its
 * own recent history. Both are sizing questions, and both are answered by those two constants.
 */
export const messageCacheLookups = new Counter({
	name: 'automoderator_message_cache_lookups_total',
	help: 'Message cache reads, by whether the message was still cached',
	labelNames: ['result'] as const,
	registers: [register],
});

/**
 * `route_class` is a coarse bucket (`member`, `message`, `user`, `webhook`), never a resolved route -- a
 * per-URL label would be per-guild cardinality by another name. Written by the `ActionExecutor` when a
 * side-effecting call is rejected, and therefore covering only this process -- a dashboard-initiated write that
 * Discord refuses is invisible here. See `automoderator_moderation_actions_total` for the same split.
 */
export const discordErrors = new Counter({
	name: 'automoderator_discord_errors_total',
	help: 'Failed Discord API calls, by HTTP status and coarse route class',
	labelNames: ['status', 'route_class'] as const,
	registers: [register],
});

/**
 * Filter hits, by which filter caught it (P5). `words` is a native Discord AutoMod hit arriving over
 * `AUTO_MODERATION_ACTION_EXECUTION`; the runners P5's later phases add report their own.
 *
 * Counts hits, not punishments: a hit with no policy configured, and one a bypass role let off, both land here.
 * That is the point -- "this rule is catching far more than you thought" is a question about hits, and
 * `automoderator_moderation_actions_total` already answers the one about punishments.
 */
export const filterHits = new Counter({
	name: 'automoderator_filter_hits_total',
	help: 'Filter hits, by filter',
	labelNames: ['filter'] as const,
	registers: [register],
});
