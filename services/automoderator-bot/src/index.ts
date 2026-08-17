import { dirname, join } from 'node:path';
import { setInterval } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { getContext } from '@chatsift/backend-core';
import { registerCommandHandlers, registerComponentHandlers } from '@chatsift/bot-core';
import type { Client } from '@discordjs/core';
import { registerAuditObserver } from './lib/auditObserver.js';
import { AUTO_PARDON_SWEEP_INTERVAL_MS, sweepAutoPardons } from './lib/autoPardonSweep.js';
import { registerAutomodIntake } from './lib/automodIntake.js';
import { EXPIRED_BAN_SWEEP_INTERVAL_MS, sweepExpiredBans } from './lib/expiredBanSweep.js';
import { startMetricsServer } from './lib/metricsServer.js';

const baseDir = dirname(fileURLToPath(import.meta.url));

export async function bin(client: Client): Promise<void> {
	await registerComponentHandlers(join(baseDir, 'components'));
	await registerCommandHandlers(join(baseDir, 'commands'));
	registerAutomodIntake(client);
	registerAuditObserver(client);
	startMetricsServer();

	setInterval(async () => {
		try {
			await sweepExpiredBans(getContext().logger);
		} catch (error) {
			getContext().logger.error({ err: error }, 'Failed to sweep expired temporary bans');
		}
	}, EXPIRED_BAN_SWEEP_INTERVAL_MS).unref();

	setInterval(async () => {
		try {
			await sweepAutoPardons(getContext().logger);
		} catch (error) {
			getContext().logger.error({ err: error }, 'Failed to sweep auto-pardoned warns');
		}
	}, AUTO_PARDON_SWEEP_INTERVAL_MS).unref();
}
