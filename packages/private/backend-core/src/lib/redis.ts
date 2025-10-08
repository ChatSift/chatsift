import type { Logger } from 'pino';
import { createClient } from 'redis';
import { ENV } from './env.js';

export async function createRedis(logger: Logger) {
	return createClient({ url: ENV.REDIS_URL })
		.on('error', (err) => logger.error(err, 'redis error'))
		.connect();
}
