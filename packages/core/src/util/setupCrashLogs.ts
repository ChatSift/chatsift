import process from 'node:process';
import type { Logger } from 'pino';
import { INJECTION_TOKENS, globalContainer } from '../container.js';

export function setupCrashLogs() {
	const logger = globalContainer.get<Logger>(INJECTION_TOKENS.logger);

	process.on('uncaughtExceptionMonitor', (error, origin) => {
		logger.fatal({ error, origin }, 'Uncaught exception. Likely a hard crash');
	});
}
