import 'reflect-metadata';
import { globalContainer, DependencyManager } from '@automoderator/core';
import { Gateway } from './gateway.js';

const dependencyManager = globalContainer.get(DependencyManager);
dependencyManager.registerRedis();
dependencyManager.registerApi();

const gateway = globalContainer.get(Gateway);
await gateway.connect();
