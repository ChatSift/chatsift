import { register } from '../../core/metrics.js';
import { defineRoute } from '../../core/route.js';
import { requireMetricsSecret } from '../../middleware/requireMetricsSecret.js';

/**
 * Prometheus scrape endpoint (issue #277). Deliberately unversioned (`/metrics`, not `/v3/...`) --
 * matches the bare `/metrics` every other scrape target in `build/prometheus/prometheus.yml`
 * (cadvisor, node-exporter, postgres-exporter) already exposes, since this is the ops/scrape plane,
 * not the versioned product API surface the rest of `app.ts`'s routes belong to.
 *
 * Bypasses `mountRoute`'s JSON auto-serialization the same way `dozzle/webhook.ts` does (writes the
 * response directly, calls `res.end()`, returns nothing) -- Prometheus expects its own text
 * exposition format here, not a JSON envelope.
 */
export default defineRoute({
	method: 'get',
	path: '/metrics',
	middleware: [requireMetricsSecret()],
	async handler(_req, res) {
		res.setHeader('Content-Type', register.contentType);
		res.end(await register.metrics());
	},
});
