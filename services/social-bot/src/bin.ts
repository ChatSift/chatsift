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

const logger = createLogger('social-bot');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });
registerShutdownHandlers();

const rest = createBotRest({ botId: 'SOCIAL', register, token: ENV.SOCIAL_BOT_TOKEN });

const gateway = await createBotGateway({
	botId: 'SOCIAL',
	token: ENV.SOCIAL_BOT_TOKEN,
	intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
	rest,
});

const client = createBotClient({ botId: 'SOCIAL', gateway, register, rest });
setServiceValue('client', client);

await bin(client);
startMetricsServer({ port: ENV.SOCIAL_METRICS_PORT, register });
await gateway.connect();
