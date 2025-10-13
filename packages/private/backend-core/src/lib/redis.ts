import { Buffer } from 'node:buffer';
import type { Logger } from 'pino';
import { createClient, RESP_TYPES } from 'redis';

export async function createRedis(logger: Logger) {
	return createClient({ url: 'redis://redis:6379' })
		.withTypeMapping({
			[RESP_TYPES.BLOB_STRING]: Buffer,
		})
		.on('error', (err) => logger.error(err, 'redis error'))
		.connect();
}
