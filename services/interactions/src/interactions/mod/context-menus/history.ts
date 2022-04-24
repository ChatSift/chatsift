import { ApplicationCommandType } from 'discord-api-types/v9';

export const HistoryContextMenu = {
	name: 'History',
	type: ApplicationCommandType.User,
	default_permission: false,
} as const;
