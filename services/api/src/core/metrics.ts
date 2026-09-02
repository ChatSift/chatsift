import { Counter, Histogram, Registry } from 'prom-client';

/**
 * Dedicated registry (not prom-client's process-wide default) so `/metrics` stays scoped to exactly what is
 * declared here, without `collectDefaultMetrics()` (Node process/GC/event-loop metrics) implicitly riding along
 * on the same output. That's a cheap follow-up if broader process observability is ever wanted.
 *
 * **Originally scoped to per-route HTTP metrics only (#277); that scope has since widened.** The AMA counters
 * below are domain metrics, not HTTP ones, and they are here because the dashboard is AMA's *primary*
 * moderation surface -- most approvals, denials and merges happen through these routes rather than through the
 * bot's queue buttons. `ama-bot` defines the same two metric names in its own registry with `source="bot"`, so
 * a Grafana panel summing across both jobs sees the real total. Leaving them out would have made the bot's
 * numbers read as "moderation stopped" for any guild that triages on the web, which is the same blind spot
 * `automoderator-bot`'s `reportsTotal` doc comment records and lives with for DM reports.
 *
 * **Cardinality discipline** applies here exactly as it does in the bots: never label by guild, user, channel
 * or message id. Per-AMA numbers are `routes/ama/getAMAStats.ts`'s job.
 */
export const register = new Registry();

/**
 * Per-route request duration, in seconds (Prometheus convention: base units, `_seconds` suffix).
 * `route` is the route *pattern* (e.g. `/v3/guilds/:guildId`), not the resolved URL -- see the timing
 * middleware in `./server.ts`, the single place this is observed from -- so cardinality stays bounded
 * by the number of route definitions, not by however many distinct guild/user/etc IDs get requested.
 * Request counts fall out of this histogram for free too (`_count`/`rate(...)` in Grafana), no
 * separate Counter needed.
 */
export const httpRequestDuration = new Histogram({
	name: 'http_request_duration_seconds',
	help: 'Duration of HTTP requests in seconds, labelled by route pattern, method, and status code',
	labelNames: ['method', 'route', 'status_code'] as const,
	buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
	registers: [register],
});

/**
 * The dashboard half of `ama_moderation_decisions_total`. **Label set must stay identical to `ama-bot`'s
 * `lib/metrics.ts`** -- a divergence doesn't error, it silently splits the sum into two half-populated series.
 *
 * `source` is always `dashboard` here; the bot always passes `bot`.
 */
export const amaModerationDecisions = new Counter({
	name: 'ama_moderation_decisions_total',
	help: 'Moderation decisions on questions, by decision and which surface made it',
	labelNames: ['decision', 'source'] as const,
	registers: [register],
});

/**
 * The dashboard half of `ama_session_transitions_total`. Same "keep the labels identical" rule as above.
 *
 * The bot's `source` values are `command` and `scheduled`; this one only ever emits `dashboard`.
 */
export const amaSessionTransitions = new Counter({
	name: 'ama_session_transitions_total',
	help: 'AMA session transitions, by what happened and what caused it',
	labelNames: ['transition', 'source'] as const,
	registers: [register],
});

/**
 * prom-client emits no series for a label combination until it is first incremented, so a counter that has
 * legitimately never fired reads as "No data" on a dashboard rather than `0`. See the fuller note in
 * `services/modmail-bot/src/lib/metrics.ts`.
 */
for (const decision of ['approve', 'approve_and_send', 'deny', 'merge']) {
	amaModerationDecisions.inc({ decision, source: 'dashboard' }, 0);
}

for (const transition of ['closed', 'prompt_reposted']) {
	amaSessionTransitions.inc({ transition, source: 'dashboard' }, 0);
}
