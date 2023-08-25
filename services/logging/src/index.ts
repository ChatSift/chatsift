import 'reflect-metadata';
import { globalContainer, DependencyManager } from '@automoderator/core';
import { LoggingService } from './Service.js';

const dependencyManager = globalContainer.get(DependencyManager);
dependencyManager.registerRedis();
dependencyManager.registerApi();
dependencyManager.registerLogger();
dependencyManager.registerDatabase();

await globalContainer.get(LoggingService).start();
