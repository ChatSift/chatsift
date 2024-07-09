import 'reflect-metadata';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	type ICommandHandler,
	CoralCommandHandler,
	globalContainer,
	DependencyManager,
	setupCrashLogs,
	encode,
	decode,
	type DiscordGatewayEventsMap,
	USEFUL_HANDLERS_PATH,
	type HandlerModuleConstructor,
	type HandlerModule,
} from '@automoderator/core';
import { readdirRecurseManyAsync } from '@chatsift/readdir';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { GatewayDispatchEvents } from '@discordjs/core';
import type { InteractionHandler as CoralInteractionHandler } from 'coral-command';

const dependencyManager = globalContainer.get(DependencyManager);
const logger = dependencyManager.registerLogger('interactions');
const redis = dependencyManager.registerRedis();
dependencyManager.registerApi();

setupCrashLogs();

const commandHandler = globalContainer.get<ICommandHandler<CoralInteractionHandler>>(CoralCommandHandler);

export const serviceHandlersPath = join(dirname(fileURLToPath(import.meta.url)), 'handlers');

for (const path of await readdirRecurseManyAsync([serviceHandlersPath, USEFUL_HANDLERS_PATH])) {
	const moduleConstructor: HandlerModuleConstructor<CoralInteractionHandler> = await import(path);
	const module = globalContainer.get<HandlerModule<CoralInteractionHandler>>(moduleConstructor);

	module.register(commandHandler);
	logger.info(`Loaded handler/module ${module.constructor.name}`);
}

const broker = new PubSubRedisBroker<DiscordGatewayEventsMap>({
	redisClient: redis,
	encode,
	decode,
});

broker.on(GatewayDispatchEvents.InteractionCreate, async ({ data: interaction, ack }) => {
	await commandHandler.handle(interaction);
	await ack();
});

await broker.subscribe('interactions', [GatewayDispatchEvents.InteractionCreate]);
