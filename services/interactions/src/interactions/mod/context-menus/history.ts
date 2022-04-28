import { ApplicationCommandType, PermissionFlagsBits } from 'discord-api-types/v9';

export const HistoryContextMenu = {
	name: 'History',
	type: ApplicationCommandType.User,
	default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
} as const;
