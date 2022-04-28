import { UserPerms } from '@automoderator/discord-permissions';
import { ApplicationCommandType, PermissionFlagsBits } from 'discord-api-types/v9';

export const HistoryContextMenu = {
	name: 'History',
	type: ApplicationCommandType.User,
	default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
	perms: UserPerms.mod,
} as const;
