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

const logger = createLogger('modmail-bot');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });

const rest = createBotRest({ token: ENV.MODMAIL_BOT_TOKEN });
// Unlike AMA (component/modal-driven only, `Guilds` suffices), this bot relays real user message
// content out of private threads, so it needs `GuildMessages` + the privileged `MessageContent`
// intent (must also be toggled on for the bot application in the Discord developer portal).
const gateway = createBotGateway({
	token: ENV.MODMAIL_BOT_TOKEN,
	intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent,
	rest,
});
const client = createBotClient({ botId: 'MODMAIL', gateway, rest });
setServiceValue('client', client);

await bin(client);
await gateway.connect();
