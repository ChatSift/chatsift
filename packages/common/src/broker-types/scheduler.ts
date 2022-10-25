import type { Task } from '@prisma/client';

export enum SchedulerEventType {
	TaskCreate = 'task_create',
}

export type SchedulerEventMap = {
	[SchedulerEventType.TaskCreate]: Task;
};
