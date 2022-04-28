import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const WarnCommand = {
	name: 'warn',
	description: 'Warns a member',
	default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
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
			name: 'reference',
			description: 'The reference case',
			type: ApplicationCommandOptionType.Integer,
		},
	],
} as const;
