import 'reflect-metadata';
import { DependencyManager, Env, globalContainer, setupCrashLogs } from '@automoderator/core';
import { ProxyServer } from './server.js';

const dependencyManager = globalContainer.get(DependencyManager);
const logger = dependencyManager.registerLogger('discordproxy');
dependencyManager.registerRedis();

setupCrashLogs();

const server = globalContainer.get(ProxyServer);
const env = globalContainer.get(Env);

const port = Number(new URL(env.discordProxyURL).port);

server.listen(port);
logger.info(`Listening on port ${port}`);
