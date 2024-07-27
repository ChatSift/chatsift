import 'reflect-metadata';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CoralCommandHandler,
	globalContainer,
	DependencyManager,
	setupCrashLogs,
	encode,
	decode,
	ICommandHandler,
	type DiscordGatewayEventsMap,
	USEFUL_HANDLERS_PATH,
	type HandlerModuleConstructor,
	type HandlerModule,
	Env,
} from '@automoderator/core';
import { readdirRecurseManyAsync, ReadMode } from '@chatsift/readdir';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { GatewayDispatchEvents } from '@discordjs/core';
import type { InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { IComponentStateStore } from './state/IComponentStateStore.js';
import { RedisComponentStateStore } from './state/RedisComponentDataStore.js';

const dependencyManager = globalContainer.get(DependencyManager);
const logger = dependencyManager.registerLogger('interactions');
const redis = dependencyManager.registerRedis();
const api = dependencyManager.registerApi();

globalContainer.bind<IComponentStateStore>(IComponentStateStore).to(RedisComponentStateStore);
globalContainer.bind<ICommandHandler<CoralInteractionHandler>>(ICommandHandler).to(CoralCommandHandler);

setupCrashLogs();

const commandHandler = globalContainer.get<ICommandHandler<CoralInteractionHandler>>(ICommandHandler);

export const serviceHandlersPath = join(dirname(fileURLToPath(import.meta.url)), 'handlers');

for (const path of await readdirRecurseManyAsync([serviceHandlersPath, USEFUL_HANDLERS_PATH], {
	fileExtensions: ['js'],
	readMode: ReadMode.file,
})) {
	const moduleConstructor: HandlerModuleConstructor<CoralInteractionHandler> = await import(path).then(
		(mod) => mod.default,
	);
	const module = globalContainer.get<HandlerModule<CoralInteractionHandler>>(moduleConstructor);

	module.register(commandHandler);
	logger.info(`Loaded handler/module ${module.constructor.name}`);
}

const broker = new PubSubRedisBroker<DiscordGatewayEventsMap>({
	// @ts-expect-error - Version miss-match
	redisClient: redis,
	encode,
	decode,
});

async function ensureFirstDeployment(): Promise<void> {
	const env = globalContainer.resolve(Env);

	const existing = await api.applicationCommands.getGlobalCommands(env.discordClientId);
	if (!existing.length) {
		logger.info('No global commands found, deploying (one-time)...');
		await commandHandler.deployCommands();
	}
}

await ensureFirstDeployment();

broker.on(GatewayDispatchEvents.InteractionCreate, async ({ data: interaction, ack }) => {
	await commandHandler.handle(interaction);
	await ack();
});

await broker.subscribe('interactions', [GatewayDispatchEvents.InteractionCreate]);
