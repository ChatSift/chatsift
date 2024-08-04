import 'reflect-metadata';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirRecurse, ReadMode } from '@chatsift/readdir';
import { DependencyManager, globalContainer, setupCrashLogs } from '@chatsift/service-core';
import ErrorHandler from './core-handlers/error.js';
import SetupHandler from './core-handlers/setup.js';
import { Server, type Registerable, type RegisterableConstructor } from './server.js';

const dependencyManager = globalContainer.get(DependencyManager);
const logger = dependencyManager.registerLogger('api');
dependencyManager.registerRedis();
dependencyManager.registerApi();

setupCrashLogs();

const server = globalContainer.get(Server);

export const handlersPath = join(dirname(fileURLToPath(import.meta.url)), 'handlers');

// Those need to be loaded before everything else
server.register(globalContainer.resolve(SetupHandler));
server.register(globalContainer.resolve(ErrorHandler));

for await (const path of readdirRecurse(handlersPath, { fileExtensions: ['js'], readMode: ReadMode.file })) {
	const moduleConstructor: RegisterableConstructor = await import(path).then((mod) => mod.default);
	const module = globalContainer.get<Registerable>(moduleConstructor);

	server.register(module);
	logger.info(`Loaded module ${module.constructor.name}`);
}

await server.listen();
