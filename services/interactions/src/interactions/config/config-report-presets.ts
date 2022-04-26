import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const ConfigReportPresetsCommand = {
	name: 'config-report-presets',
	description: 'Manage preset report options shown in the Report Message with Reason context menu',
	options: [
		{
			name: 'add',
			description: 'Adds a preset report reason',
			type: ApplicationCommandOptionType.Subcommand,
			options: [
				{
					name: 'reason',
					description: 'The reason to add',
					type: ApplicationCommandOptionType.String,
					required: true,
				},
			],
		},
		{
			name: 'delete',
			description: 'Deletes a preset report reason',
			type: ApplicationCommandOptionType.Subcommand,
			options: [
				{
					name: 'id',
					description: 'The id of the reason to delete',
					type: ApplicationCommandOptionType.Integer,
					required: true,
				},
			],
		},
		{
			name: 'list',
			description: 'Lists all the existing preset reasons',
			type: ApplicationCommandOptionType.Subcommand,
			options: [],
		},
	],
} as const;
