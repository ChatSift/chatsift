import 'reflect-metadata';
import { DependencyManager, globalContainer, setupCrashLogs } from '@automoderator/core';
import { ProxyServer } from './server.js';

const dependencyManager = globalContainer.get(DependencyManager);
const logger = dependencyManager.registerLogger('discordproxy');
dependencyManager.registerRedis();

setupCrashLogs();

const server = globalContainer.get(ProxyServer);
server.listen(9_000);
logger.info('Listening on port 9000');
