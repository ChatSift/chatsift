import { UserPerms } from '@automoderator/discord-permissions';
import { ApplicationCommandType } from 'discord-api-types/v9';

export const HistoryContextMenu = {
	name: 'History',
	type: ApplicationCommandType.User,
	default_permission: false,
	perms: UserPerms.mod,
} as const;