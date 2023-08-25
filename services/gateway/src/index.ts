import 'reflect-metadata';
import { globalContainer, DependencyManager } from '@automoderator/core';
import { Gateway } from './gateway.js';

const dependencyManager = globalContainer.get(DependencyManager);
dependencyManager.registerRedis();
dependencyManager.registerApi();
dependencyManager.registerLogger();

await globalContainer.get(Gateway).connect();
