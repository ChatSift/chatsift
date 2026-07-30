import { Histogram, Registry } from 'prom-client';

/**
 * Dedicated registry (not prom-client's process-wide default) so `/metrics` stays scoped to exactly
 * what issue #277 asked for -- per-route request counts/latency -- without `collectDefaultMetrics()`
 * (Node process/GC/event-loop metrics) implicitly riding along on the same output. That's a cheap
 * follow-up if broader process observability is ever wanted, not needed for this.
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
