import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCommandHandlers } from '@chatsift/bot-core';
import type { Client } from '@discordjs/core';
import { registerAutomodIntake } from './lib/automodIntake.js';
import { startMetricsServer } from './lib/metricsServer.js';

const baseDir = dirname(fileURLToPath(import.meta.url));

export async function bin(client: Client): Promise<void> {
	await registerCommandHandlers(join(baseDir, 'commands'));
	registerAutomodIntake(client);
	startMetricsServer();
}
