import 'reflect-metadata';
import { globalContainer, DependencyManager } from '@automoderator/core';
import { TaskRunnerService } from './service.js';

const dependencyManager = globalContainer.get(DependencyManager);
dependencyManager.registerLogger();
dependencyManager.registerDatabase();

await globalContainer.get(TaskRunnerService).start();
