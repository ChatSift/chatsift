import { createDatabase, createLogger, createRedis, initContext, registerFatalErrorHandlers } from '@chatsift/backend-core';

const logger = createLogger('api');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });

// Make sure to import anything else AFTER initializing the context
const { startServer } = await import('./app.js');
await startServer();
