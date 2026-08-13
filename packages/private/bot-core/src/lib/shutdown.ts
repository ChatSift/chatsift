import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as sleep } from 'node:timers/promises';
import { getContext } from '@chatsift/backend-core';

/**
 * Total budget for the whole shutdown sequence. Docker's default `stop_grace_period` is 10s, after which the
 * container is SIGKILLed -- staying comfortably under that means the exit is ours (ordered, logged) rather than
 * a kill in the middle of a redis write.
 */
const SHUTDOWN_DEADLINE_MS = 8_000;

/**
 * How long in-flight event handlers get to finish after the shutdown starts. Nothing tracks in-flight work
 * explicitly (handlers are fire-and-forget off gateway events), so this is a plain grace period rather than a
 * real drain -- enough for a Discord round trip already in progress, short enough to stay inside the deadline.
 */
const DRAIN_GRACE_MS = 1_500;

type ShutdownStep = () => Promise<void>;

/**
 * How long after a shutdown starts a repeat signal is treated as a duplicate delivery of the same event rather
 * than as a second, impatient request.
 *
 * One Ctrl+C routinely arrives more than once. The terminal sends SIGINT to every process in the foreground
 * process group, and wrappers commonly forward it to their child on top of that -- `dotenv-cli`, which every
 * `yarn dev:*` script here runs through, does exactly that (`cli.js`: `process.on(signal, () =>
 * child.kill(signal))`). Without this window the very first Ctrl+C in dev would skip every shutdown step,
 * leaving the replica lease held and the gateway session unflushed.
 */
const DUPLICATE_SIGNAL_WINDOW_MS = 2_000;

const steps: { name: string; run: ShutdownStep }[] = [];
let shutdownStartedAt: number | null = null;

/**
 * Registers work to run before the process exits, in registration order. Intended for anything that must reach
 * redis or the database one last time -- flushing gateway sessions, releasing a replica lease, dropping this
 * replica's guild-list entry -- since `registerShutdownHandlers` tears both connections down after the last step.
 *
 * A step that throws is logged and skipped; one broken step must not strand the rest.
 */
export function onShutdown(name: string, run: ShutdownStep): void {
	steps.push({ name, run });
}

async function runSteps(): Promise<void> {
	for (const { name, run } of steps) {
		try {
			await run();
		} catch (error) {
			getContext().logger.error({ err: error, step: name }, 'shutdown step failed');
		}
	}
}

async function shutdown(signal: string): Promise<void> {
	if (shutdownStartedAt !== null) {
		// Same Ctrl+C reaching us twice, not a second request -- see `DUPLICATE_SIGNAL_WINDOW_MS`.
		if (Date.now() - shutdownStartedAt < DUPLICATE_SIGNAL_WINDOW_MS) {
			return;
		}

		// Genuinely pressed again while we were working: stop being graceful and go. `SHUTDOWN_DEADLINE_MS`
		// guarantees an exit regardless, so this is only ever an early out for an impatient operator.
		getContext().logger.warn({ signal }, 'second shutdown signal, exiting immediately');
		process.exit(0);
	}

	shutdownStartedAt = Date.now();
	const { logger, db, redis } = getContext();
	logger.info({ signal }, 'shutting down');

	// Deliberately NOT `.unref()`'d, for the same reason as `registerFatalErrorHandlers`' flush timer: this is
	// what guarantees an exit even if a step below hangs on a dead redis.
	const deadline = setTimeout(() => {
		logger.error({ deadlineMs: SHUTDOWN_DEADLINE_MS }, 'shutdown deadline exceeded, exiting anyway');
		process.exit(0);
	}, SHUTDOWN_DEADLINE_MS);

	await sleep(DRAIN_GRACE_MS);
	await runSteps();

	// The gateway is deliberately never destroyed here, which looks like an omission and is not.
	// `WebSocketManager.destroy` takes `Omit<WebSocketShardDestroyOptions, 'recover'>` -- `recover` cannot be
	// passed at the manager level -- so every manager-level destroy hits the `options.recover !== Resume` branch
	// in `@discordjs/ws` and calls `updateSessionInfo(shardId, null)`, wiping exactly the sessions `lib/sessions.ts`
	// just flushed. Letting the process exit with its sockets open instead leaves Discord holding a resumable
	// session, which is the entire point of storing them: the next boot RESUMEs and gets the gap replayed.
	try {
		await Promise.all([redis.quit(), db.end({ timeout: 2 })]);
	} catch (error) {
		logger.error({ err: error }, 'failed to close redis/database cleanly');
	}

	clearTimeout(deadline);
	logger.info('shutdown complete');

	// Mirrors `registerFatalErrorHandlers`: in production pino writes through a worker-thread transport, so
	// exiting immediately after the line above can kill the process before it reaches the transport.
	const flushTimer = setTimeout(() => process.exit(0), 2_000);
	logger.flush(() => {
		clearTimeout(flushTimer);
		process.exit(0);
	});
}

/**
 * Installs `SIGTERM`/`SIGINT` handlers that run every `onShutdown` step, then close redis and the database, then
 * flush the logger and exit 0.
 *
 * Before this existed nothing in the repo handled either signal: `docker compose stop` killed bots on Node's
 * default behaviour, mid-write, with no session flush and no lease release. That is survivable at one replica and
 * is not once replicas hand shard ranges between each other -- a lease that is dropped rather than released stays
 * held until its TTL expires, so the shards it covers stay dark for that long on every deliberate restart.
 *
 * Call once per process, from `bin.ts`, alongside `registerFatalErrorHandlers`.
 */
export function registerShutdownHandlers(): void {
	for (const signal of ['SIGTERM', 'SIGINT'] as const) {
		process.on(signal, () => {
			void shutdown(signal);
		});
	}
}
