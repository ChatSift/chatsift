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
import { createBotClient, createBotGateway, createBotRest, registerShutdownHandlers } from '@chatsift/bot-core';
import { GatewayIntentBits } from '@discordjs/core';
import { bin } from './index.js';

const logger = createLogger('automoderator-bot');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });
registerShutdownHandlers();

await loadExperiments();

const rest = createBotRest({ token: ENV.AUTOMODERATOR_BOT_TOKEN });

const gateway = await createBotGateway({
	botId: 'AUTOMODERATOR',
	token: ENV.AUTOMODERATOR_BOT_TOKEN,
	intents: GatewayIntentBits.Guilds | GatewayIntentBits.AutoModerationExecution | GatewayIntentBits.GuildModeration,
	rest,
});

const client = createBotClient({ botId: 'AUTOMODERATOR', gateway, rest });
setServiceValue('client', client);

await bin(client);
await gateway.connect();
