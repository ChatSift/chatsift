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
for (const decision of ['anonymize', 'approve', 'approve_and_send', 'deny', 'merge']) {
	amaModerationDecisions.inc({ decision, source: 'dashboard' }, 0);
}

for (const transition of ['closed', 'prompt_reposted']) {
	amaSessionTransitions.inc({ transition, source: 'dashboard' }, 0);
}

/**
 * The dashboard half of `appeals_decisions_total` (#232 P5). **Label set must stay identical to
 * `services/appeals-bot`'s `lib/metrics.ts`** -- a divergence doesn't error, it silently splits the sum into
 * two half-populated series, same as the AMA counters above.
 *
 * Worth having rather than leaving to the bot, for the reason `outcome` exists at all: `failed` means the claim
 * was given back because Discord refused the unban, and every one of those is an appeal a moderator believes
 * they approved. That failure is reachable from this surface too, and a counter that only watches the card
 * would report "no failures" for a guild that triages on the web.
 *
 * `source` is always `dashboard` here; the bot passes `card` for its three buttons and `system` for the moot
 * close a lifted ban triggers (P4b).
 */
export const appealDecisions = new Counter({
	name: 'appeals_decisions_total',
	help: 'Appeal decisions, by decision, what came of it, and which surface made it',
	labelNames: ['decision', 'outcome', 'source'] as const,
	registers: [register],
});

for (const decision of ['approved', 'denied', 'denied_silent']) {
	for (const outcome of ['applied', 'failed', 'raced']) {
		appealDecisions.inc({ decision, outcome, source: 'dashboard' }, 0);
	}
}

/**
 * The dashboard half of `appeals_deliveries_total` (#232 P6). **Label set must stay identical to
 * `services/appeals-bot`'s `lib/metrics.ts`**, same as the counter above.
 *
 * `kind` is `dm` or `rejoin`, because they fail for unrelated reasons and a single outcome label would hide
 * that: a DM is refused by the *appellant's* privacy settings, and a re-add by a permission the *guild* never
 * granted. `outcome` is `sent`/`blocked`/`failed`/`skipped` for a DM (`skipped` being a silent denial, which is
 * the feature working) and `added`/`invited`/`none` for a rejoin.
 *
 * The one worth alerting on is `kind="dm", outcome="failed"`: `blocked` is an appellant with their DMs shut,
 * which nothing we deploy can fix, but `failed` is our side and every one of those is a decision somebody was
 * owed and did not get.
 */
export const appealDeliveries = new Counter({
	name: 'appeals_deliveries_total',
	help: 'What became of an appeal decision after it was made, by what was attempted and how it went',
	labelNames: ['kind', 'outcome', 'source'] as const,
	registers: [register],
});

for (const outcome of ['sent', 'blocked', 'failed', 'skipped']) {
	appealDeliveries.inc({ kind: 'dm', outcome, source: 'dashboard' }, 0);
}

for (const outcome of ['added', 'invited', 'none']) {
	appealDeliveries.inc({ kind: 'rejoin', outcome, source: 'dashboard' }, 0);
}
