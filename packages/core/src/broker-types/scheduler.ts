import type { Task } from '@prisma/client';

export enum SchedulerEventType {
	TaskCreate = 'task_create',
}

export interface SchedulerEventMap {
	[SchedulerEventType.TaskCreate]: Task;
}
