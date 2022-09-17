import { setInterval } from 'node:timers';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { CaseManager } from '@automoderator/util';
import ms from '@naval-base/ms';
import { CaseAction, PrismaClient } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';

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
			where: { runAt: { lte: new Date() } },
			orderBy: { runAt: 'asc' },
			include: { timedCase: true },
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
					this.logger.warn(
						{
							error,
							task,
						},
						'Task failed to run 3 times, deleting anyway',
					);
				} else {
					await this.prisma.task.update({
						data: {
							attempts: task.attempts,
							runAt: new Date(task.runAt.getTime() + 1_000 * 10 ** task.attempts),
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
		const cases = await this.prisma.case.findMany({
			where: {
				pardonedBy: null,
				actionType: CaseAction.warn,
			},
		});
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
					data: { pardonedBy: this.config.discordClientId },
					where: { id: cs.id },
				});
			}
		}
	}

	private async deescalateAutomodPunishments(): Promise<void> {
		const automodCooldownCache = new Map<string, number | null>();
		const triggers = await this.prisma.automodTrigger.findMany();

		for (const trigger of triggers) {
			let automodCooldown = automodCooldownCache.get(trigger.guildId);

			if (automodCooldown === null) {
				void this.prisma.automodTrigger
					.delete({
						where: {
							guildId_userId: {
								guildId: trigger.guildId,
								userId: trigger.userId,
							},
						},
					})
					.catch(() => null);
				continue;
			} else {
				const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: trigger.guildId } });
				automodCooldown = settings?.automodCooldown ?? null;
				automodCooldownCache.set(trigger.guildId, automodCooldown);
				if (!automodCooldown) {
					continue;
				}
			}

			if (new Date().getMinutes() - trigger.updatedAt.getMinutes() >= automodCooldown) {
				const updated = await this.prisma.automodTrigger.update({
					data: { count: { decrement: 1 } },
					where: {
						guildId_userId: {
							guildId: trigger.guildId,
							userId: trigger.userId,
						},
					},
				});

				if (updated.count <= 0) {
					void this.prisma.automodTrigger.delete({
						where: {
							guildId_userId: {
								guildId: trigger.guildId,
								userId: trigger.userId,
							},
						},
					});
				}
			}
		}
	}

	private async handleTimedCase(id: number): Promise<unknown> {
		const cs = await this.prisma.case.findFirst({
			where: { id },
			rejectOnNotFound: true,
		});
		if (!cs.useTimeouts) {
			return this.caseManager.undoTimedAction(cs);
		}
	}

	public init(): void {
		setInterval(() => {
			void this.handleTasks();
			void this.handleAutoPardons();
			void this.deescalateAutomodPunishments();
		}, 1e4).unref();
	}
}
