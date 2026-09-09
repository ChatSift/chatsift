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

const gateway = await createBotGateway({
	botId: 'APPEALS',
	token: ENV.APPEALS_BOT_TOKEN,
	// `Guilds` for the guild list (GUILD_CREATE/GUILD_DELETE/READY), `GuildModeration` for GUILD_BAN_ADD and
	// GUILD_BAN_REMOVE. Both are non-privileged, so unlike `automoderator-bot` this application needs no intent
	// approval to grow past Discord's verification threshold -- worth keeping true, since nothing Appeals does
	// wants message content or the member list.
	intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildModeration,
	rest,
});

const client = createBotClient({ botId: 'APPEALS', gateway, register, rest });
setServiceValue('client', client);

await bin(client);
startMetricsServer({ port: ENV.APPEALS_METRICS_PORT, register });
await gateway.connect();
