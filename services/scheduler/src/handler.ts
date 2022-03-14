import { PrismaClient } from '@prisma/client';
import { singleton } from 'tsyringe';

@singleton()
export class Handler {
	public constructor(public readonly prisma: PrismaClient) {}

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
				timedCase: {
					include: {
						case: true,
					},
				},
			},
		});

		for (const task of tasks) {
		}
	}

	public init(): void {
		setTimeout(() => void this.handle(), 1e4).unref();
	}
}
