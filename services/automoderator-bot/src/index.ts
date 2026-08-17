import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCommandHandlers, registerComponentHandlers } from '@chatsift/bot-core';
import type { Client } from '@discordjs/core';
import { registerAuditObserver } from './lib/auditObserver.js';
import { registerAutomodIntake } from './lib/automodIntake.js';
import { startMetricsServer } from './lib/metricsServer.js';

const baseDir = dirname(fileURLToPath(import.meta.url));

export async function bin(client: Client): Promise<void> {
	await registerComponentHandlers(join(baseDir, 'components'));
	await registerCommandHandlers(join(baseDir, 'commands'));
	registerAutomodIntake(client);
	registerAuditObserver(client);
	startMetricsServer();
}
