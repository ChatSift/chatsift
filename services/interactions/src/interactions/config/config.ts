import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const ConfigCommand = {
	name: 'config',
	description: "Update your server's config",
	default_permission: true,
	options: [
		{
			name: 'muterole',
			description: 'Role used to silence people when they are muted',
			type: ApplicationCommandOptionType.Role,
			required: false,
		},
		{
			name: 'pardonwarnsafter',
			description: 'How many days to take before automatically pardoning warnings',
			type: ApplicationCommandOptionType.Integer,
			required: false,
			min_value: 0,
		},
		{
			name: 'joinage',
			description: 'Account age required for a user to be allowed into the server',
			type: ApplicationCommandOptionType.String,
			required: false,
		},
		{
			name: 'blankavatar',
			description: 'Disallows members with a blank avatar from joining your server',
			type: ApplicationCommandOptionType.Boolean,
			required: false,
		},
		{
			name: 'reportschannel',
			description: 'Channel for user reports to be sent in',
			type: ApplicationCommandOptionType.Channel,
			required: false,
		},
	],
} as const;
