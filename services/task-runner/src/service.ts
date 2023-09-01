import { setInterval } from 'node:timers';
import { INJECTION_TOKENS, type DB, type Task, Env } from '@automoderator/core';
import { inject, injectable } from 'inversify';
import { Kysely, sql, type Selectable } from 'kysely';
import { type Logger } from 'pino';

@injectable()
export class TaskRunnerService {
	public constructor(
		@inject(Kysely) private readonly database: Kysely<DB>,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
		private readonly env: Env,
	) {}

	public async start(): Promise<void> {
		setInterval(async () => {
			if (this.env.taskRunnerId === null) {
				this.logger.warn('This process does not have a task runner ID, cannot operate.');
				return;
			}

			const tasks = await this.database
				.selectFrom('Task')
				.selectAll()
				.where(sql`mod(Task.id, ${this.env.taskRunnerConcurrency}) = ${this.env.taskRunnerId}`)
				.execute();

			for (const task of tasks) {
				try {
					await this.handle(task);
					await this.database.deleteFrom('Task').where('id', '=', task.id).execute();
				} catch (error) {
					this.logger.error({ err: error, task }, 'Failed to handle task');
					const attempts = task.attempts + 1;
					if (attempts >= 3) {
						this.logger.warn(task, 'That was the 3rd attempt for that task; deleting');
						await this.database.deleteFrom('Task').where('id', '=', task.id).execute();
					} else {
						await this.database.updateTable('Task').set({ attempts }).where('id', '=', task.id).execute();
					}
				}
			}
		});

		this.logger.info('Listening to incoming tasks');
	}

	private async handle(task: Selectable<Task>): Promise<void> {
		switch (task.type) {
			default: {
				this.logger.warn(task, `Unimplemented task type: ${task.type}`);
				break;
			}
		}
	}
}
