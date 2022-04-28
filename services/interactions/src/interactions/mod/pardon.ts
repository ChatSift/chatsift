import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const PardonCommand = {
	name: 'pardon',
	description: 'Pardons the given warn case',
	default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
	options: [
		{
			name: 'case',
			description: 'The case to look pardon',
			type: ApplicationCommandOptionType.Integer,
			required: true,
		},
	],
} as const;
