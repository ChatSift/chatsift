import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const ConfigLogIgnoresCommand = {
	name: 'config-log-ignores',
	description: 'Configure logging exclusions',
	default_member_permissions: String(PermissionFlagsBits.ManageGuild),
	options: [
		{
			name: 'update',
			description: 'Configure logging exclusions',
			type: ApplicationCommandOptionType.Subcommand,
			options: [],
		},
		{
			name: 'show',
			description: 'Shows all of the currently ignored channels',
			type: ApplicationCommandOptionType.Subcommand,
			options: [],
		},
	],
} as const;
