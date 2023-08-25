import type { ColumnType } from 'kysely';
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
	? ColumnType<S, I | undefined, U>
	: ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export const LogChannelType = {
	mod: 'mod',
	filter: 'filter',
	user: 'user',
	message: 'message',
} as const;
export type LogChannelType = (typeof LogChannelType)[keyof typeof LogChannelType];
export const CaseAction = {
	warn: 'warn',
	mute: 'mute',
	unmute: 'unmute',
	kick: 'kick',
	softban: 'softban',
	ban: 'ban',
	unban: 'unban',
} as const;
export type CaseAction = (typeof CaseAction)[keyof typeof CaseAction];
export const TaskType = {
	timedModAction: 'timedModAction',
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];
export type Case = {
	id: Generated<number>;
	guildId: string;
	logChannelId: string | null;
	logMessageId: string | null;
	caseId: number;
	refId: number | null;
	targetId: string;
	targetTag: string;
	modId: string | null;
	modTag: string | null;
	actionType: CaseAction;
	reason: string | null;
	expiresAt: Timestamp | null;
	pardonedBy: string | null;
	createdAt: Generated<Timestamp>;
	useTimeouts: Generated<boolean>;
	deleteDays: number | null;
};
export type LogChannelWebhook = {
	guildId: string;
	logType: LogChannelType;
	channelId: string;
	webhookId: string;
	webhookToken: string;
	threadId: string | null;
};
export type Task = {
	id: Generated<number>;
	type: TaskType;
	guildId: string;
	createdAt: Generated<Timestamp>;
	runAt: Timestamp;
	attempts: Generated<number>;
	data: unknown;
};
export type UnmuteRole = {
	caseId: number;
	roleId: string;
};
export type DB = {
	Case: Case;
	LogChannelWebhook: LogChannelWebhook;
	Task: Task;
	UnmuteRole: UnmuteRole;
};
