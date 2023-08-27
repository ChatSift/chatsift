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
	role: 'role',
	unrole: 'unrole',
	warn: 'warn',
	timeout: 'timeout',
	revokeTimeout: 'revokeTimeout',
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
export type BanCaseData = {
	id: number;
	deleteMessageDays: number | null;
};
export type Case = {
	id: Generated<number>;
	guildId: string;
	logChannelId: string | null;
	logMessageId: string | null;
	targetId: string;
	modId: string | null;
	actionType: CaseAction;
	reason: string | null;
	createdAt: Generated<Timestamp>;
};
export type CaseReferences = {
	caseId: number;
	refId: number;
};
export type LogChannelWebhook = {
	guildId: string;
	logType: LogChannelType;
	channelId: string;
	webhookId: string;
	webhookToken: string;
	threadId: string | null;
};
export type RoleCaseData = {
	id: number;
	roleId: string;
	clean: Generated<boolean>;
	duration: number | null;
	expiresAt: Timestamp | null;
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
export type UndoRole = {
	caseId: number;
	roleId: string;
};
export type WarnCaseData = {
	id: number;
	pardonedById: string | null;
};
export type DB = {
	BanCaseData: BanCaseData;
	Case: Case;
	CaseReferences: CaseReferences;
	LogChannelWebhook: LogChannelWebhook;
	RoleCaseData: RoleCaseData;
	Task: Task;
	UndoRole: UndoRole;
	WarnCaseData: WarnCaseData;
};
