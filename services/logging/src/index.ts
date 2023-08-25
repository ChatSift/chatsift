import 'reflect-metadata';
import { globalContainer, DependencyManager } from '@automoderator/core';
import { LoggingService } from './Service.js';

globalContainer.get(DependencyManager).registerRedis().registerApi().registerLogger().registerPrisma();
await globalContainer.get(LoggingService).start();
