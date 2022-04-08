import { ApplicationCommandType } from 'discord-api-types/v9';

export const ReportMessageReasonContextMenu = {
	name: 'Report Message with Reason',
	type: ApplicationCommandType.Message,
} as const;
