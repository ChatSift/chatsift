import type { GuildListKey } from '@chatsift/backend-core';
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
import { createBotClient, createBotGateway, createBotRest } from '@chatsift/bot-core';
import { GatewayIntentBits } from '@discordjs/core';
import { bin } from './index.js';

const logger = createLogger('modmail-bot');
registerFatalErrorHandlers(logger);

const db = createDatabase();
const redis = await createRedis(logger);
initContext({ db, logger, redis });

// Throws (crashing this process) if `ENV.MODMAIL_INSTANCE_ID` is set but matches no
// `modmail_instances` row -- a custom deployment with no resolvable identity can't safely run at
// all. See docs/roadmap/08-modmail-custom-instances.md.
await loadInstances();

const selfInstance = getSelfInstance();
const token = selfInstance?.token ?? ENV.MODMAIL_BOT_TOKEN;
const botId: GuildListKey = selfInstance ? `MODMAIL#${selfInstance.id}` : 'MODMAIL';

const rest = createBotRest({ token });
// Unlike AMA (component/modal-driven only, `Guilds` suffices), this bot relays real user message
// content out of private threads, so it needs `GuildMessages` + the privileged `MessageContent`
// intent (must also be toggled on for the bot application in the Discord developer portal).
// `DirectMessages` is added ahead of when it's actually needed -- P4's DM-mode opener flow (see the
// roadmap doc above) -- since it's harmless for a deployment nobody DMs and toggling it later would
// mean every deployment needs a resync of its gateway session either way.
const gateway = createBotGateway({
	token,
	intents:
		GatewayIntentBits.Guilds |
		GatewayIntentBits.GuildMessages |
		GatewayIntentBits.MessageContent |
		GatewayIntentBits.DirectMessages,
	rest,
});
const client = createBotClient({ botId, gateway, rest });
setServiceValue('client', client);

await bin(client);
await gateway.connect();
