import {
	createDatabase,
	createLogger,
	createRedis,
	ENV,
	initContext,
	loadExperiments,
	registerFatalErrorHandlers,
	setServiceValue,
} from '@chatsift/backend-core';
import {
	createBotClient,
	createBotGateway,
	createBotRest,
	registerShutdownHandlers,
	startMetricsServer,
} from '@chatsift/bot-core';
import { GatewayIntentBits } from '@discordjs/core';
import { register } from './lib/metrics.js';
import { bin } from './index.js';

const logger = createLogger('ama-bot');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });
registerShutdownHandlers();

// Feature gates -- `postToQueue` decides whether to draw the anonymity toggle off this snapshot, and
// `toggleAnonymous.ts` re-checks it before writing (#366).
await loadExperiments();

const rest = createBotRest({ botId: 'AMA', register, token: ENV.AMA_BOT_TOKEN });
const gateway = await createBotGateway({
	botId: 'AMA',
	token: ENV.AMA_BOT_TOKEN,
	intents: GatewayIntentBits.Guilds,
	rest,
});
setServiceValue('client', createBotClient({ botId: 'AMA', gateway, register, rest }));

await bin();
startMetricsServer({ port: ENV.AMA_METRICS_PORT, register });
await gateway.connect();
