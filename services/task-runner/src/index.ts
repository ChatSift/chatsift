import 'reflect-metadata';
import { globalContainer, DependencyManager } from '@automoderator/core';
import { TaskRunnerService } from './service.js';

globalContainer.get(DependencyManager).registerRedis().registerPrisma().registerLogger();
await globalContainer.get(TaskRunnerService).start();
