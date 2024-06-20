import 'reflect-metadata';
import { globalContainer, DependencyManager, setupCrashLogs } from '@automoderator/core';
import { Gateway } from './gateway.js';

const dependencyManager = globalContainer.get(DependencyManager);
dependencyManager.registerLogger('gateway');
dependencyManager.registerRedis();
dependencyManager.registerApi();

setupCrashLogs();

const gateway = globalContainer.get(Gateway);
await gateway.connect();
