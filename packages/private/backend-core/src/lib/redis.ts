import { Buffer } from 'node:buffer';
import type { Logger } from 'pino';
import { createClient, RESP_TYPES } from 'redis';
import { ENV } from './env.js';

export async function createRedis(logger: Logger) {
	return createClient({ url: ENV.REDIS_URL })
		.withTypeMapping({
			[RESP_TYPES.BLOB_STRING]: Buffer,
		})
		.on('error', (err) => logger.error(err, 'redis error'))
		.connect();
}
