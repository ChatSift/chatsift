import 'reflect-metadata';
import type { SchedulerEventMap } from '@automoderator/common';
import { SchedulerEventType, createLogger, Env, encode, decode } from '@automoderator/common';
import { PubSubRedisBroker } from '@discordjs/brokers';
import type { Task } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { container } from 'tsyringe';

const logger = createLogger('task-runner');

const env = container.resolve(Env);
const redis = new Redis(env.redisUrl);
const prisma = new PrismaClient();

const broker = new PubSubRedisBroker<SchedulerEventMap>({ redisClient: redis, encode, decode });

async function handle(task: Task) {
	switch (task.type) {
		default: {
			logger.warn(task, `Unimplemented task type: ${task.type}`);
			break;
		}
	}
}

broker.on(SchedulerEventType.TaskCreate, async ({ data: task, ack }) => {
	try {
		await handle(task);
		await prisma.task.delete({ where: { id: task.id } });
	} catch (error) {
		logger.error({ err: error, task }, 'Failed to handle task');
		const retries = task.attempts + 1;
		if (retries >= 3) {
			logger.warn(task, 'That was the 3rd retry for that task; deleting');
			await prisma.task.delete({ where: { id: task.id } });
		}
	}

	await ack();
});

await broker.subscribe('task-runners', [SchedulerEventType.TaskCreate]);
logger.info('Listening to incoming tasks');
