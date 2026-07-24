import {
	createDatabase,
	createLogger,
	createRedis,
	ENV,
	initContext,
	registerFatalErrorHandlers,
	setServiceValue,
} from '@chatsift/backend-core';
import { createBotClient, createBotGateway, createBotRest } from '@chatsift/bot-core';
import { GatewayIntentBits } from '@discordjs/core';
import { bin } from './index.js';

const logger = createLogger('ama-bot');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });

const rest = createBotRest({ token: ENV.AMA_BOT_TOKEN });
const gateway = createBotGateway({ token: ENV.AMA_BOT_TOKEN, intents: GatewayIntentBits.Guilds, rest });
setServiceValue('client', createBotClient({ botId: 'AMA', gateway, rest }));

await bin();
await gateway.connect();
