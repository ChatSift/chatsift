import 'reflect-metadata';
import { globalContainer, DependencyManager } from '@automoderator/core';
import { InteractionsService } from './interactions.js';

const dependencyManager = globalContainer.get(DependencyManager);
dependencyManager.registerRedis();
dependencyManager.registerApi();
dependencyManager.registerLogger();
dependencyManager.registerDatabase();

await globalContainer.get(InteractionsService).start();
