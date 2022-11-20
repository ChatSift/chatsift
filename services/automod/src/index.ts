import type { DiscordEventsMap } from '@automoderator/common';
import { decode, encode, Env } from '@automoderator/common';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { GatewayDispatchEvents } from 'discord-api-types/v10';
import Redis from 'ioredis';
import { container } from 'tsyringe';
import * as rawRunners from './runners';
import type { Runner } from './struct/Runner';
import { logger } from './util/logger';

const env = container.resolve(Env);

const redis = new Redis(env.redisUrl);
const broker = new PubSubRedisBroker<DiscordEventsMap>({ redisClient: redis, encode, decode });

broker.on(GatewayDispatchEvents.MessageCreate, async ({ data: message, ack }) => {
	const runners: Runner[] = Object.values(rawRunners).map((runner) => container.resolve(runner));
	// TODO: Run perms checks and the runners.
});

await broker.subscribe('automod', [GatewayDispatchEvents.MessageCreate, GatewayDispatchEvents.MessageUpdate]);
logger.info('Listening to incoming automod events.');
