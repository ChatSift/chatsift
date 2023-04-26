import 'reflect-metadata';
import { setInterval } from 'node:timers';
import type { SchedulerEventMap } from '@automoderator/core';
import { SchedulerEventType, createLogger, Env, encode, decode } from '@automoderator/core';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { container } from 'tsyringe';

const logger = createLogger('scheduler');

const env = container.resolve(Env);
const redis = new Redis(env.redisUrl);
const prisma = new PrismaClient();

const broker = new PubSubRedisBroker<SchedulerEventMap>({ redisClient: redis, encode, decode });

setInterval(async () => {
	const tasks = await prisma.task.findMany({
		where: {
			runAt: {
				lte: new Date(),
			},
		},
	});

	for (const task of tasks) {
		void broker.publish(SchedulerEventType.TaskCreate, task);
	}
}, 3_000);

logger.info('Scheduler started; polling for upcoming tasks every 3 seconds');
