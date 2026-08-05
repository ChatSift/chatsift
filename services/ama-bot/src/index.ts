import { dirname, join } from 'node:path';
import { setInterval } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { getContext } from '@chatsift/backend-core';
import { registerCommandHandlers, registerComponentHandlers } from '@chatsift/bot-core';
import { sweepScheduledAmaCloses } from './lib/scheduledCloseSweep.js';

const baseDir = dirname(fileURLToPath(import.meta.url));

/**
 * How often `sweepScheduledAmaCloses` runs -- matches modmail-bot's `SCHEDULED_CLOSE_SWEEP_INTERVAL_MS`
 * reasoning: a scheduled close date is minute-granularity from the dashboard's datetime picker, so this
 * needs to be short enough that it doesn't fire noticeably late, while `ama_sessions` is small enough that
 * polling it every minute is cheap.
 */
const SCHEDULED_CLOSE_SWEEP_INTERVAL_MS = 60 * 1_000;

export async function bin(): Promise<void> {
	await registerComponentHandlers(join(baseDir, 'components'));
	await registerCommandHandlers(join(baseDir, 'commands'));

	// `.unref()` so this interval never keeps the process alive on its own -- matches bot-core's
	// client.ts guild-list-sync interval and modmail-bot's own sweep intervals.
	let sweepInFlight = false;
	setInterval(async () => {
		// Guards against overlapping runs if a sweep ever takes longer than the interval (a slow DB, a
		// connection hiccup) -- skipping the tick instead of piling up concurrent queries against the same
		// small table.
		if (sweepInFlight) {
			return;
		}

		sweepInFlight = true;
		try {
			await sweepScheduledAmaCloses(getContext().logger);
		} catch (error) {
			getContext().logger.error({ err: error }, 'Failed to sweep scheduled AMA closes');
		} finally {
			// `sweepInFlight` is deliberately shared closure state read again here after the `await` above --
			// that's what trips this rule's static analysis, but Node's single-threaded event loop means the
			// only other place that reads/writes it is this same callback's next tick, which the guard above
			// already prevents from overlapping with this one.
			// eslint-disable-next-line require-atomic-updates
			sweepInFlight = false;
		}
	}, SCHEDULED_CLOSE_SWEEP_INTERVAL_MS).unref();
}
