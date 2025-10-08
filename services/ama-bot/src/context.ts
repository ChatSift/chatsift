import { createContext, createDatabase, createLogger, createRedis } from '@chatsift/backend-core';

const logger = createLogger('ama-bot');
const db = createDatabase(logger);
const redis = await createRedis(logger);

export const context = createContext({ db, logger, redis });
