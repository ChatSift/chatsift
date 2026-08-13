import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { ENV, getContext } from '@chatsift/backend-core';
import { onShutdown } from '@chatsift/bot-core';
import { register } from './metrics.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * Same guard as the API's `requireMetricsSecret` middleware -- a static shared secret over a standard
 * `Authorization: Bearer` header, because Prometheus's `scrape_config` reads it from
 * `authorization.credentials_file` and re-reads that file on every scrape, so rotating the secret needs no
 * Prometheus restart. Hash-then-`timingSafeEqual` so a mismatched buffer length can't leak the secret's size.
 */
function isAuthorized(header: string | undefined): boolean {
	const provided = typeof header === 'string' && header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';

	const providedDigest = createHash('sha256').update(provided).digest();
	const expectedDigest = createHash('sha256').update(ENV.METRICS_SECRET).digest();

	return provided !== '' && timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Binds a minimal `/metrics` listener, **in production only**.
 *
 * The asymmetry with `metrics.ts` is deliberate and is the whole design: the counters record unconditionally,
 * everywhere, so dev exercises the exact code path production does. What `IS_PRODUCTION` gates is opening a
 * port -- a dev machine has no Prometheus to scrape it, and a bot process is not a thing to casually give an
 * HTTP surface to.
 *
 * Adding the scrape job to `build/prometheus/prometheus.yml` is a separate, deliberate step (six lines,
 * following the existing `api` job), not part of any phase of the port.
 */
export function startMetricsServer(): void {
	if (!ENV.IS_PRODUCTION) {
		getContext().logger.info('Metrics collection is on; the /metrics endpoint is not bound outside production');
		return;
	}

	const server = createServer(async (req, res) => {
		if (req.url !== '/metrics') {
			res.writeHead(404).end();
			return;
		}

		if (!isAuthorized(req.headers.authorization)) {
			res.writeHead(401).end();
			return;
		}

		res.writeHead(200, { 'content-type': register.contentType });
		res.end(await register.metrics());
	});

	server.listen(ENV.AUTOMODERATOR_METRICS_PORT, () =>
		getContext().logger.info({ port: ENV.AUTOMODERATOR_METRICS_PORT }, 'Serving metrics'),
	);

	onShutdown('metrics-server', async () => {
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
	});
}
