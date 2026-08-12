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

const logger = createLogger('social-bot');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });

const rest = createBotRest({ token: ENV.SOCIAL_BOT_TOKEN });

const gateway = createBotGateway({
	token: ENV.SOCIAL_BOT_TOKEN,
	intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
	rest,
});

const client = createBotClient({ botId: 'SOCIAL', gateway, rest });
setServiceValue('client', client);

await bin(client);
await gateway.connect();
