import {
	createDatabase,
	createLogger,
	createRedis,
	initContext,
	loadInstances,
	registerFatalErrorHandlers,
} from '@chatsift/backend-core';

const logger = createLogger('api');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });

// Loads the `modmail_instances` registry `apiForGuild`/`getInstanceForGuild`/`me.ts` read from and starts its
// 60s background refresh (see docs/roadmap/08-modmail-custom-instances.md) -- unlike `services/modmail-bot`,
// the API never sets `MODMAIL_INSTANCE_ID`, so this only ever populates the registry, never resolves a "self".
await loadInstances();

// Make sure to import anything else AFTER initializing the context
const { startServer } = await import('./app.js');
await startServer();
