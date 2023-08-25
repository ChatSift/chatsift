import 'reflect-metadata';
import { DependencyManager, globalContainer } from '@automoderator/core';
import { ProxyServer } from './server.js';

// We don't need the default REST/API instance or prisma
globalContainer.get(DependencyManager).registerRedis().registerLogger();
globalContainer.get(ProxyServer).listen();
