import { UserPerms } from '@automoderator/discord-permissions';
import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const MuteCommand = {
	name: 'mute',
	description: 'Mutes a member',
	default_permission: false,
	perms: UserPerms.mod,
	options: [
		{
			name: 'user',
			description: 'The user to action',
			type: ApplicationCommandOptionType.User,
			required: true,
		},
		{
			name: 'reason',
			description: 'The reason of this action',
			type: ApplicationCommandOptionType.String,
		},
		{
			name: 'duration',
			description: 'Optional duration',
			type: ApplicationCommandOptionType.String,
		},
		{
			name: 'reference',
			description: 'The reference case',
			type: ApplicationCommandOptionType.Integer,
		},
	],
} as const;
