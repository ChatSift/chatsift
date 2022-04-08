import { ApplicationCommandType } from 'discord-api-types/v9';

export const ReportMessageContextMenu = {
	name: 'Report Message',
	type: ApplicationCommandType.Message,
} as const;
