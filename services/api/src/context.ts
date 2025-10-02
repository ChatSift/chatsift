import { createContext, createDatabase, createLogger } from '@chatsift/backend-core';

const logger = createLogger('api');
const db = createDatabase(logger);

export const context = createContext(db, logger);
