import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { ENV, getContext } from '@chatsift/backend-core';
import type { Registry } from 'prom-client';
import { onShutdown } from './shutdown.js';

const BEARER_PREFIX = 'Bearer ';

function isAuthorized(header: string | undefined): boolean {
	const provided =
		typeof header === 'string' && header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';

	const providedDigest = createHash('sha256').update(provided).digest();
	const expectedDigest = createHash('sha256').update(ENV.METRICS_SECRET).digest();

	return provided !== '' && timingSafeEqual(providedDigest, expectedDigest);
}

export type MetricsHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function createMetricsHandler(register: Registry): MetricsHandler {
	return async (req, res) => {
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
	};
}

export interface StartMetricsServerOptions {
	readonly port: number;
	/**
	 * The calling bot's own registry. Deliberately not a singleton owned by this package -- each bot owns its
	 * metric taxonomy and its name prefix (`ama_*`, `modmail_*`, ...), and one shared registry would put every
	 * bot's names in one namespace. Only the transport is shared.
	 */
	readonly register: Registry;
}

export function startMetricsServer({ port, register }: StartMetricsServerOptions): void {
	if (!ENV.IS_PRODUCTION) {
		getContext().logger.info('Metrics collection is on; the /metrics endpoint is not bound outside production');
		return;
	}

	const server = createServer(createMetricsHandler(register));

	server.listen(port, () => getContext().logger.info({ port }, 'Serving metrics'));

	onShutdown('metrics-server', async () => {
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
	});
}
