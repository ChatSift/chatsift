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

// Only what P0 needs. `AutoModerationExecution` is the one the whole banword design rests on -- without it the
// gateway simply never sends the event and the feature is silently inert. The privileged intents later phases
// want (`MessageContent` for the filter pipeline and message logs, `GuildMembers` for join-age checks) are
// deliberately absent: declaring an intent the application hasn't been granted in the developer portal makes
// Discord close the connection with a 4014 rather than degrade, so each is added alongside the phase that
// needs it and the portal toggle that goes with it.
const gateway = await createBotGateway({
	botId: 'AUTOMODERATOR',
	token: ENV.AUTOMODERATOR_BOT_TOKEN,
	intents: GatewayIntentBits.Guilds | GatewayIntentBits.AutoModerationExecution,
	rest,
});

const client = createBotClient({ botId: 'AUTOMODERATOR', gateway, rest });
setServiceValue('client', client);

await bin(client);
await gateway.connect();
