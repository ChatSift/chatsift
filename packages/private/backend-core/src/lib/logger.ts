import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import type { Logger, LoggerOptions, TransportTargetOptions } from 'pino';
import { pino as createPinoLogger, transport as pinoTransport, stdTimeFunctions } from 'pino';
import { ENV } from './env.js';

const PROD_LOG_TRANSPORT_PATH = fileURLToPath(new URL('prodLogTransport.js', import.meta.url));

export type { Logger } from 'pino';

// Upper bound on how long we wait for the worker-thread transport to flush before force-exiting anyway --
// a stuck flush shouldn't turn a crash into a hang.
const FATAL_FLUSH_TIMEOUT_MS = 5_000;

function exitAfterFlush(logger: Logger, code: number): void {
	// Deliberately NOT `.unref()`'d: this timer (or the flush callback below) must be what keeps the event
	// loop alive here. Once the exception handler returns, nothing else is pending -- an unref'd timer lets
	// Node drain the loop and exit(0) on its own before either callback below ever runs.
	const timer = setTimeout(() => {
		process.exit(code);
	}, FATAL_FLUSH_TIMEOUT_MS);

	logger.flush(() => {
		clearTimeout(timer);
		process.exit(code);
	});
}

/**
 * Registers process-wide handlers so an uncaught exception or unhandled rejection is logged as a single
 * structured `fatal` line -- instead of Node's default raw, multi-line stack trace, which Docker's json-file
 * driver splits into a separate log record per line (each independently tripping log-based alerting).
 *
 * `logger.flush()` is required before exiting: in production the logger writes through a worker-thread
 * transport (see `createLogger`), which is asynchronous -- `process.exit()` right after `logger.fatal()` can
 * kill the process before that write actually reaches the transport, silently dropping the log entirely.
 */
export function registerFatalErrorHandlers(logger: Logger): void {
	process.on('uncaughtException', (err) => {
		logger.fatal({ err }, 'uncaught exception, exiting');
		exitAfterFlush(logger, 1);
	});
	process.on('unhandledRejection', (reason) => {
		logger.fatal({ err: reason }, 'unhandled rejection, exiting');
		exitAfterFlush(logger, 1);
	});
}

/**
 * Split out from `createLogger` so tests can construct a pino instance against a plain in-memory stream (no
 * worker-thread transport) while still exercising the exact same options -- the `redact` config in particular.
 */
export function createLoggerOptions(name: string): LoggerOptions {
	return {
		level: 'trace',
		name,
		timestamp: stdTimeFunctions.isoTime,
		formatters: {
			// Emit `level` as the string label (e.g. `"info"`) instead of pino's default numeric value --
			// dozzle parses log level from this exact string.
			level: (label) => ({ level: label }),
		},
		// `@discordjs/rest` errors carry the literal request body (including OAuth `client_secret`/`refresh_token`)
		// on `.requestBody.json` -- redact those specific fields wherever an error ends up logged, regardless of
		// whether it's nested under an explicit `err` key or passed as pino's bare first argument.
		redact: {
			paths: ['err.requestBody.json.client_secret', 'err.requestBody.json.refresh_token'],
			censor: '[REDACTED]',
		},
	};
}

export function createLogger(name: string) {
	const targets: TransportTargetOptions[] = ENV.IS_PRODUCTION
		? [
				{
					// A single target that itself writes to both stdout (dozzle) and a day-rotated file on disk
					// (`dir` is relative to the service's cwd; docker-compose bind-mounts `./logs/<name>` over it
					// so the files are readable from the host -- see prodLogTransport.ts for why this must stay
					// one target instead of two).
					target: PROD_LOG_TRANSPORT_PATH,
					level: 'trace',
					options: {
						dir: `logs/${name}`,
					},
				},
			]
		: [
				{
					target: 'pino-pretty',
					level: 'trace',
					options: {
						destination: 1, // stdout
						colorize: true,
						translateTime: 'SYS:standard',
					},
				},
			];

	const transport = pinoTransport({
		targets,
		level: 'trace',
	});

	return createPinoLogger(createLoggerOptions(name), transport);
}
