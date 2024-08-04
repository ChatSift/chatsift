import 'reflect-metadata';
import { credentialsForCurrentBot, DependencyManager, globalContainer, setupCrashLogs } from '@automoderator/core';
import { ProxyServer } from './server.js';

const dependencyManager = globalContainer.get(DependencyManager);
const logger = dependencyManager.registerLogger('discordproxy');
dependencyManager.registerRedis();

setupCrashLogs();

const server = globalContainer.get(ProxyServer);

const credentials = credentialsForCurrentBot();
const port = Number(new URL(credentials.proxyURL).port);

server.listen(port);
logger.info(`Listening on port ${port}`);
