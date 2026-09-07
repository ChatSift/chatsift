import {
	createDatabase,
	createLogger,
	createRedis,
	initContext,
	loadExperiments,
	loadInstances,
	registerFatalErrorHandlers,
} from '@chatsift/backend-core';

const logger = createLogger('api');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });

// Loads the `modmail_instances` registry `apiForGuild`/`getInstanceForGuild`/`me.ts` read from and starts its
// 60s background refresh (see docs/roadmap/01-architecture.md §8) -- unlike `services/modmail-bot`,
// the API never sets `MODMAIL_INSTANCE_ID`, so this only ever populates the registry, never resolves a "self".
await loadInstances();

// Feature gates (docs/roadmap/11-automoderator-port.md's "Feature gating"). The API is the enforcement point
// for every gated write, and `me.ts` reports each guild's enabled set so the dashboard can hide a control
// rather than render one that 403s -- both read the snapshot this loads.
await loadExperiments();

// Make sure to import anything else AFTER initializing the context
const { startServer } = await import('./app.js');
await startServer();
