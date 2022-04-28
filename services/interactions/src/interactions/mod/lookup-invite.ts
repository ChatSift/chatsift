import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const LookupInviteCommand = {
	name: 'lookup-invite',
	description: 'Looks up server information from a given invite',
	default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
	options: [
		{
			name: 'invite',
			description: 'The invite to look up',
			type: ApplicationCommandOptionType.String,
			required: true,
		},
	],
} as const;
