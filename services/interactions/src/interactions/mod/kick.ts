import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const KickCommand = {
	name: 'kick',
	description: 'Kicks a member',
	default_member_permissions: String(PermissionFlagsBits.KickMembers),
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
