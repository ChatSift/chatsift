import {
	createDatabase,
	createLogger,
	createRedis,
	initContext,
	registerFatalErrorHandlers,
	setServiceValue,
} from '@chatsift/backend-core';

const logger = createLogger('ama-bot');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });

// Make sure to import anything else AFTER initializing the context
const { createClient } = await import('./lib/client.js');
setServiceValue('client', createClient());

const { bin } = await import('./index.js');
await bin();
