import {
	createDatabase,
	createLogger,
	createRedis,
	ENV,
	initContext,
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

const logger = createLogger('appeals-bot');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });
registerShutdownHandlers();

const rest = createBotRest({ botId: 'APPEALS', register, token: ENV.APPEALS_BOT_TOKEN });
startMetricsServer({ port: ENV.APPEALS_METRICS_PORT, register });

const gateway = await createBotGateway({
	botId: 'APPEALS',
	token: ENV.APPEALS_BOT_TOKEN,
	intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildModeration,
	register,
	rest,
});

const client = createBotClient({ botId: 'APPEALS', gateway, register, rest });
setServiceValue('client', client);

await bin(client);
await gateway.connect();
