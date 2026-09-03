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
import { register } from './lib/metrics.js';
import { bin } from './index.js';

const logger = createLogger('automoderator-bot');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });
registerShutdownHandlers();

await loadExperiments();

const rest = createBotRest({ botId: 'AUTOMODERATOR', register, token: ENV.AUTOMODERATOR_BOT_TOKEN });

const gateway = await createBotGateway({
	botId: 'AUTOMODERATOR',
	token: ENV.AUTOMODERATOR_BOT_TOKEN,
	// `GuildMembers` and `MessageContent` are **privileged** and must be enabled on the application in
	// Discord's developer portal, or the gateway refuses the IDENTIFY outright (P4, feature 34). They are the
	// price of the message and profile logs: without `MessageContent` every cached message has empty text, and
	// without `GuildMembers` no `GUILD_MEMBER_UPDATE` arrives at all. Legacy AutoModerator held both.
	intents:
		GatewayIntentBits.Guilds |
		GatewayIntentBits.GuildMembers |
		GatewayIntentBits.GuildMessages |
		GatewayIntentBits.MessageContent |
		GatewayIntentBits.AutoModerationExecution |
		GatewayIntentBits.GuildModeration,
	rest,
});

const client = createBotClient({ botId: 'AUTOMODERATOR', gateway, register, rest });
setServiceValue('client', client);

await bin(client);
await gateway.connect();
