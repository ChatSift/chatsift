import type { Case, TimedCaseTask } from '@prisma/client';
import { Runnable } from './runnable';

export class TimedCaseRunnable extends Runnable<TimedCaseTask & { case: Case }> {
	public async run(): Promise<void> {}
}
