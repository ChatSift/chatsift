import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as sleep } from 'node:timers/promises';
import { getContext } from '@chatsift/backend-core';

/**
 * Total budget for the whole shutdown sequence. Docker's default `stop_grace_period` is 10s.
 */
const SHUTDOWN_DEADLINE_MS = 8_000;

const DRAIN_GRACE_MS = 2_000;

type ShutdownStep = () => Promise<void>;

const DUPLICATE_SIGNAL_WINDOW_MS = 2_000;

const steps: { name: string; run: ShutdownStep }[] = [];
let shutdownStartedAt: number | null = null;

export function onShutdown(name: string, run: ShutdownStep): void {
	steps.push({ name, run });
}

async function runRegisteredSteps(): Promise<void> {
	for (const { name, run } of [...steps].reverse()) {
		try {
			await run();
		} catch (error) {
			getContext().logger.error({ err: error, step: name }, 'shutdown step failed');
		}
	}
}

async function shutdown(signal: string): Promise<void> {
	if (shutdownStartedAt !== null) {
		// IME Ctrl+C at least in dev was often doubled. This is a pretty annoying fix but I can't really help it
		if (Date.now() - shutdownStartedAt < DUPLICATE_SIGNAL_WINDOW_MS) {
			return;
		}

		// Unlikely to be duplicated. Standard handling is to not even wait for the remaining teardown
		getContext().logger.warn({ signal }, 'second shutdown signal, exiting immediately');
		process.exit(0);
	}

	shutdownStartedAt = Date.now();
	const { logger, db, redis } = getContext();
	logger.info({ signal }, 'shutting down');

	const deadline = setTimeout(() => {
		logger.error({ deadlineMs: SHUTDOWN_DEADLINE_MS }, 'shutdown deadline exceeded, exiting anyway');
		process.exit(0);
	}, SHUTDOWN_DEADLINE_MS);

	await sleep(DRAIN_GRACE_MS);
	await runRegisteredSteps();

	// TODO: discord.js PR
	try {
		await Promise.all([redis.quit(), db.end({ timeout: 2 })]);
	} catch (error) {
		logger.error({ err: error }, 'failed to close redis/database cleanly');
	}

	clearTimeout(deadline);
	logger.info('shutdown complete');

	const flushTimer = setTimeout(() => process.exit(0), 2_000);
	logger.flush(() => {
		clearTimeout(flushTimer);
		process.exit(0);
	});
}

export function registerShutdownHandlers(): void {
	for (const signal of ['SIGTERM', 'SIGINT'] as const) {
		process.on(signal, () => {
			void shutdown(signal);
		});
	}
}
