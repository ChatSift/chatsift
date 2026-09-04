import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@chatsift/backend-core';
import { ENV, getContext } from '@chatsift/backend-core';
import {
	registerCommandHandlers,
	registerComponentHandlers,
	registerUnknownComponentResolver,
	startMetricsServer,
} from '@chatsift/bot-core';
import type { Client } from '@discordjs/core';
import { registerAuditObserver } from './lib/auditObserver.js';
import { AUTO_PARDON_SWEEP_INTERVAL_MS, sweepAutoPardons } from './lib/autoPardonSweep.js';
import { registerAutomodIntake } from './lib/automodIntake.js';
import { EXPIRED_BAN_SWEEP_INTERVAL_MS, sweepExpiredBans } from './lib/expiredBanSweep.js';
import { registerFilterRunner } from './lib/filterRunner.js';
import { registerJoinGate } from './lib/joinGate.js';
import { resolveLegacyRolePrompt } from './lib/legacyRolePrompts.js';
import { registerMessageObserver } from './lib/messageObserver.js';
import { register } from './lib/metrics.js';
import { registerProfileObserver } from './lib/profileObserver.js';
import { sweepTriggerDecay, TRIGGER_DECAY_SWEEP_INTERVAL_MS } from './lib/triggerDecaySweep.js';

const baseDir = dirname(fileURLToPath(import.meta.url));

export async function bin(client: Client): Promise<void> {
	await registerComponentHandlers(join(baseDir, 'components'));
	registerUnknownComponentResolver(resolveLegacyRolePrompt);
	await registerCommandHandlers(join(baseDir, 'commands'));
	registerAutomodIntake(client);
	registerAuditObserver(client);
	registerFilterRunner(client);
	registerJoinGate(client);
	registerMessageObserver(client);
	registerProfileObserver(client);
	startMetricsServer({ port: ENV.AUTOMODERATOR_METRICS_PORT, register });

	scheduleSweep('expired temporary bans', EXPIRED_BAN_SWEEP_INTERVAL_MS, sweepExpiredBans);
	scheduleSweep('auto-pardoned warns', AUTO_PARDON_SWEEP_INTERVAL_MS, sweepAutoPardons);
	scheduleSweep('decayed filter triggers', TRIGGER_DECAY_SWEEP_INTERVAL_MS, sweepTriggerDecay);
}

/**
 * Runs a sweep on a loop, scheduling the next run only once the current one settles.
 *
 * Self-rescheduling rather than `setInterval`, which starts its next callback whether or not the last one has
 * finished. The two case sweeps do Discord work bounded by a batch size, and that bound only means anything if one
 * batch is in flight at a time -- a rate-limited run outlasting its interval would otherwise stack batches on one
 * replica. It costs nothing in correctness (each claims its rows atomically, so overlapping runs would take
 * disjoint work) and everything in being able to reason about how much this bot is doing at once. Same shape,
 * and the same reasoning, as `modmail-bot`'s auto-archive sweep.
 *
 * `.unref()` so no loop keeps the process alive on its own.
 */
function scheduleSweep(name: string, intervalMs: number, run: (logger: Logger) => Promise<void>): void {
	const scheduleNext = (): void => {
		setTimeout(async () => {
			try {
				await run(getContext().logger);
			} catch (error) {
				getContext().logger.error({ err: error }, `Failed to sweep ${name}`);
			} finally {
				scheduleNext();
			}
		}, intervalMs).unref();
	};

	scheduleNext();
}
