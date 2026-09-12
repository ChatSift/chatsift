import {
	createDatabase,
	createLogger,
	createRedis,
	ENV,
	getSelfInstance,
	initContext,
	loadInstances,
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
import { getGuildListKey } from './lib/instance.js';
import { register } from './lib/metrics.js';
import { bin } from './index.js';

const logger = createLogger('modmail-bot');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });
registerShutdownHandlers();

// Throws (crashing this process) if `ENV.MODMAIL_INSTANCE_ID` is set but matches no
// `modmail_instances` row -- a custom deployment with no resolvable identity can't safely run at
// all. See docs/roadmap/01-architecture.md §8.
await loadInstances();

const selfInstance = getSelfInstance();
const token = selfInstance?.token ?? ENV.MODMAIL_BOT_TOKEN;
const botId = getGuildListKey();

const rest = createBotRest({ botId: 'MODMAIL', register, token });
startMetricsServer({ port: ENV.MODMAIL_METRICS_PORT, register });

const gateway = await createBotGateway({
	botId,
	token,
	intents:
		GatewayIntentBits.Guilds |
		GatewayIntentBits.GuildMessages |
		GatewayIntentBits.MessageContent |
		GatewayIntentBits.DirectMessages,
	register,
	rest,
});
const client = createBotClient({ botId, gateway, register, rest });
setServiceValue('client', client);

await bin(client);
await gateway.connect();
