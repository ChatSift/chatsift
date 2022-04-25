import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const ConfigMutesCommand = {
	name: 'config-mutes',
	description: 'Manage mute settings',
	options: [
		{
			name: 'use',
			description: 'Allows you to set which mute type you want to use',
			type: ApplicationCommandOptionType.Subcommand,
			options: [
				{
					name: 'type',
					description: 'The type of mute you want to use',
					type: ApplicationCommandOptionType.String,
					required: true,
					choices: [
						{ name: 'role', value: 'role' },
						{ name: 'timeout', value: 'timeout' },
					],
				},
			],
		},
		{
			name: 'update-role',
			description: 'Update the mute role',
			type: ApplicationCommandOptionType.Subcommand,
			options: [
				{
					name: 'role',
					description: 'The role you want to use for mutes',
					type: ApplicationCommandOptionType.Role,
					required: true,
				},
			],
		},
	],
} as const;
