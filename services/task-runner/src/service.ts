import { INJECTION_TOKENS, type SchedulerEventMap, encode, decode, SchedulerEventType } from '@automoderator/core';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { PrismaClient, type Task } from '@prisma/client';
import { inject, injectable } from 'inversify';
import { Redis } from 'ioredis';
import { type Logger } from 'pino';

@injectable()
export class TaskRunnerService {
	@inject(INJECTION_TOKENS.redis)
	private readonly redis!: Redis;

	@inject(PrismaClient)
	private readonly prisma!: PrismaClient;

	@inject(INJECTION_TOKENS.logger)
	private readonly logger!: Logger;

	private readonly broker: PubSubRedisBroker<SchedulerEventMap>;

	public constructor() {
		this.broker = new PubSubRedisBroker<SchedulerEventMap>({ redisClient: this.redis, encode, decode });

		this.broker.on(SchedulerEventType.TaskCreate, async ({ data: task, ack }) => {
			try {
				await this.handle(task);
				await this.prisma.task.delete({ where: { id: task.id } });
			} catch (error) {
				this.logger.error({ err: error, task }, 'Failed to handle task');
				const attempts = task.attempts + 1;
				if (attempts >= 3) {
					this.logger.warn(task, 'That was the 3rd retry for that task; deleting');
					await this.prisma.task.delete({ where: { id: task.id } });
				} else {
					await this.prisma.task.update({
						data: {
							attempts: { increment: 1 },
						},
						where: {
							id: task.id,
						},
					});
				}
			}

			await ack();
		});
	}

	public async start(): Promise<void> {
		await this.broker.subscribe('task-runners', [SchedulerEventType.TaskCreate]);
		this.logger.info('Listening to incoming tasks');
	}

	private async handle(task: Task): Promise<void> {
		switch (task.type) {
			default: {
				this.logger.warn(task, `Unimplemented task type: ${task.type}`);
				break;
			}
		}
	}
}
