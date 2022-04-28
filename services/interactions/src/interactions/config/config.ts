import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const ConfigCommand = {
	name: 'config',
	description: "Update your server's config",
	default_member_permissions: String(PermissionFlagsBits.ManageGuild),
	options: [
		{
			name: 'modrole',
			description: 'Role used to identify people as moderators',
			type: ApplicationCommandOptionType.Role,
			required: false,
		},
		{
			name: 'adminrole',
			description: 'Role used to identify people as admins',
			type: ApplicationCommandOptionType.Role,
			required: false,
		},
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
		},
		{
			name: 'modlogchannel',
			description: 'Moderation action logging',
			type: ApplicationCommandOptionType.Channel,
			required: false,
		},
		{
			name: 'filterslogchannel',
			description: 'Filter trigger logging',
			type: ApplicationCommandOptionType.Channel,
			required: false,
		},
		{
			name: 'userupdatelogchannel',
			description: 'Where to log username/nickname updates',
			type: ApplicationCommandOptionType.Channel,
			required: false,
		},
		{
			name: 'messageslogchannel',
			description: 'Where to log message update/deletes',
			type: ApplicationCommandOptionType.Channel,
			required: false,
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
