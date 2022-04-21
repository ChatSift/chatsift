import { PrismaClient } from '@prisma/client';
import { inject, singleton } from 'tsyringe';
import { CaseManager } from '@automoderator/util';
import { kLogger } from '@automoderator/injection';
import type { Logger } from 'pino';

@singleton()
export class Handler {
	public constructor(
		public readonly prisma: PrismaClient,
		public readonly caseManager: CaseManager,
		@inject(kLogger) public readonly logger: Logger,
	) {}

	private async handle(): Promise<void> {
		const tasks = await this.prisma.task.findMany({
			where: {
				runAt: {
					lte: new Date(),
				},
			},
			orderBy: {
				runAt: 'asc',
			},
			include: {
				timedCase: true,
			},
		});

		for (const task of tasks) {
			try {
				if (task.timedCase) {
					await this.handleTimedCase(task.timedCase.caseId);
				} else {
					this.logger.warn({ task }, 'Unknown task type');
					continue;
				}
			} catch (error) {
				if (task.attempts++ >= 3) {
					this.logger.warn({ error, task }, 'Task failed to run 3 times, deleting anyway');
				} else {
					await this.prisma.task.update({
						data: {
							attempts: task.attempts,
							runAt: new Date(task.runAt.getTime() + 1000 * Math.pow(10, task.attempts)),
						},
						where: { id: task.id },
					});

					continue;
				}
			}

			await this.prisma.task.delete({ where: { id: task.id } });
		}
	}

	private async handleTimedCase(id: number): Promise<unknown> {
		const cs = await this.prisma.case.findFirst({ where: { id }, rejectOnNotFound: true });
		if (!cs.useTimeouts) {
			return this.caseManager.undoTimedAction(cs);
		}
	}

	public init(): void {
		setTimeout(() => void this.handle(), 1e4).unref();
	}
}
