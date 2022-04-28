import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const ConfigCommand = {
	name: 'config',
	description: "Update your server's config",
	default_member_permissions: String(PermissionFlagsBits.ManageGuild),
	options: [
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
		{
			name: 'modlogschannel',
			description: 'Channel to log mod cases to',
			type: ApplicationCommandOptionType.Channel,
			required: false,
		},
		{
			name: 'filterlogschannel',
			description: 'Channel to log filter triggers to',
			type: ApplicationCommandOptionType.Channel,
			required: false,
		},
		{
			name: 'userlogschannel',
			description: 'Channel to log user updates (name, nickname, etc) to',
			type: ApplicationCommandOptionType.Channel,
			required: false,
		},
		{
			name: 'messagelogschannel',
			description: 'Channel to log message update/deletes to',
			type: ApplicationCommandOptionType.Channel,
			required: false,
		},
	],
} as const;
