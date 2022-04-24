import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const LookupInviteCommand = {
	name: 'lookup-invite',
	description: 'Looks up server information from a given invite',
	options: [
		{
			name: 'invite',
			description: 'The invite to look up',
			type: ApplicationCommandOptionType.String,
			required: true,
		},
	],
} as const;
