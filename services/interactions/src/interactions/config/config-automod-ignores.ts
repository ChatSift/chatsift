import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const ConfigAutomodIgnoresCommand = {
	name: 'config-automod-ignores',
	description: 'Configure automoderation exclusions',
	options: [
		{
			name: 'update',
			description: 'Configure automoderation exclusions',
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
