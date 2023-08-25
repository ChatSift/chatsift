import 'reflect-metadata';
import { globalContainer, DependencyManager } from '@automoderator/core';
import { Gateway } from './gateway.js';

// We don't need prisma
globalContainer.get(DependencyManager).registerRedis().registerApi().registerLogger();
await globalContainer.get(Gateway).connect();
