import { createDatabase, createLogger, createRedis, initContext } from '@chatsift/backend-core';

const logger = createLogger('ama-bot');
const db = createDatabase(logger);
const redis = await createRedis(logger);
initContext({ db, logger, redis });

// Make sure to import anything else AFTER initializing the context
const { bin } = await import('./index.js');
await bin();
