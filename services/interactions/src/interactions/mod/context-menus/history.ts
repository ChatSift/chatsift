import { ApplicationCommandType } from 'discord-api-types/v9';

export const HistoryContextMenu = {
	name: 'History',
	type: ApplicationCommandType.User,
} as const;
