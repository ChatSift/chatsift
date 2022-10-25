import 'reflect-metadata';
import { setInterval } from 'node:timers';
import type { SchedulerEventMap } from '@automoderator/common';
import { SchedulerEventType, createLogger, Env, encode, decode } from '@automoderator/common';
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
		await broker.publish(SchedulerEventType.TaskCreate, task);
	}
}, 3_000);

logger.info('Scheduler started; polling for upcoming tasks every 3 seconds');
