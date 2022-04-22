import { CaseAction, PrismaClient } from '@prisma/client';
import { inject, singleton } from 'tsyringe';
import { CaseManager } from '@automoderator/util';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import type { Logger } from 'pino';
import ms from '@naval-base/ms';

@singleton()
export class Handler {
	public constructor(
		public readonly prisma: PrismaClient,
		public readonly caseManager: CaseManager,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kConfig) public readonly config: Config,
	) {}

	private async handleTasks(): Promise<void> {
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

	private async handleAutoPardons(): Promise<void> {
		const cases = await this.prisma.case.findMany({ where: { pardonedBy: null, actionType: CaseAction.warn } });
		const pardonAfterCache = new Map<string, number | null>();

		for (const cs of cases) {
			let pardonAfter = pardonAfterCache.get(cs.guildId);

			if (pardonAfter === null) {
				continue;
			} else if (!pardonAfter) {
				const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: cs.guildId } });
				pardonAfter = settings?.autoPardonWarnsAfter ?? null;
				pardonAfterCache.set(cs.guildId, pardonAfter);
				if (!pardonAfter) {
					continue;
				}
			}

			if (cs.createdAt.getTime() + ms(`${pardonAfter}d`) <= Date.now()) {
				await this.prisma.case.update({
					data: {
						pardonedBy: this.config.discordClientId,
					},
					where: { id: cs.id },
				});
			}
		}
	}

	private async handleTimedCase(id: number): Promise<unknown> {
		const cs = await this.prisma.case.findFirst({ where: { id }, rejectOnNotFound: true });
		if (!cs.useTimeouts) {
			return this.caseManager.undoTimedAction(cs);
		}
	}

	public init(): void {
		setTimeout(() => {
			void this.handleTasks();
			void this.handleAutoPardons();
		}, 1e4).unref();
	}
}
