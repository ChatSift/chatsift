import type { Task } from '@prisma/client';
import { TimedCaseRunnable } from './timedCaseRunnable';

export abstract class Runnable {
	public static from(data: Task): Runnable | null {
		switch (data.type) {
			case 'timedCase': {
				return new TimedCaseRunnable(data);
			}
		}

		return null;
	}

	public constructor(protected readonly data: any) {}

	public abstract run(): Promise<void>;
}
