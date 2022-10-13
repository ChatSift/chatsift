import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const BypassCommand = {
	name: 'bypass',
	description: 'Manage bypass roles in your server',
	default_member_permissions: String(PermissionFlagsBits.ManageGuild),
	options: [
		{
			name: 'add',
			description: 'Adds a role to the bypass list',
			type: ApplicationCommandOptionType.Subcommand,
			options: [
				{
					name: 'role',
					description: 'The role to add',
					type: ApplicationCommandOptionType.Role,
					required: true,
				},
			],
		},
		{
			name: 'remove',
			description: 'Removes a role from the bypass list',
			type: ApplicationCommandOptionType.Subcommand,
			options: [
				{
					name: 'role',
					description: 'The role to remove',
					type: ApplicationCommandOptionType.Role,
					required: true,
				},
			],
		},
		{
			name: 'list',
			description: 'Lists all the bypass roles',
			type: ApplicationCommandOptionType.Subcommand,
			options: [],
		},
	],
} as const;
