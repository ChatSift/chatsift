import 'reflect-metadata';
import { createLogger, DiscordEventsMap, Env, encode, decode } from '@automoderator/common';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { REST } from '@discordjs/rest';
import { PrismaClient } from '@prisma/client';
import { GatewayDispatchEvents } from 'discord-api-types/v10';
import Redis from 'ioredis';
import { container } from 'tsyringe';

const env = container.resolve(Env);

const logger = createLogger('interactions');
const rest = new REST({ api: `${env.discordProxyURL}/api` }).setToken(env.discordToken);
const prisma = new PrismaClient();

container.register(REST, { useValue: rest });
container.register(PrismaClient, { useValue: prisma });

const redis = new Redis(env.redisUrl);
const broker = new PubSubRedisBroker<DiscordEventsMap>({ redisClient: redis, encode, decode });

// eslint-disable-next-line @typescript-eslint/no-misused-promises
broker.on(GatewayDispatchEvents.InteractionCreate, async ({ data: interaction, ack }) => {
	logger.info(interaction);
	await ack();
});

await broker.subscribe('interactions', [GatewayDispatchEvents.InteractionCreate]);
logger.info('Listening to incoming interactions');
