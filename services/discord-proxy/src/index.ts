import 'reflect-metadata';
import { DependencyManager, globalContainer } from '@automoderator/core';
import { ProxyServer } from './server.js';

// We don't need the default REST/API instance or prisma
const dependencyManager = globalContainer.get(DependencyManager);
dependencyManager.registerRedis();
dependencyManager.registerLogger();

globalContainer.get(ProxyServer).listen();
