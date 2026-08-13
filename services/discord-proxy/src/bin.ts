import { createLogger, ENV, registerFatalErrorHandlers } from '@chatsift/backend-core';
import { createProxyServer } from './index.js';

const logger = createLogger('discord-proxy');
registerFatalErrorHandlers(logger);

// Deliberately no `initContext`: this service touches neither postgres nor redis, and shouldn't be able to.
// Keeping it dependency-free means a database outage can't take Discord connectivity down with it, and that
// the process can start before either is reachable -- which matters, since every other service now waits on
// this one's healthcheck.
const server = createProxyServer(logger);

server.listen(ENV.DISCORD_PROXY_PORT, () =>
	logger.info({ port: ENV.DISCORD_PROXY_PORT }, 'Proxying Discord REST requests'),
);
