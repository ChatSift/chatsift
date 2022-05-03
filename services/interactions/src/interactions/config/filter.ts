import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const FilterCommand = {
	name: 'filter',
	description: 'Allows you to interact with the config - add, remove or list entries in any given filter',
	default_member_permissions: String(PermissionFlagsBits.ManageGuild),
	options: [
		{
			name: 'config',
			description: "Allows you to interact with the server's filter config",
			type: ApplicationCommandOptionType.SubcommandGroup,
			options: [
				{
					name: 'show',
					description: 'Shows the current config',
					type: ApplicationCommandOptionType.Subcommand,
					options: [],
				},
				{
					name: 'edit',
					description: 'Edits the current config',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'urls',
							description: 'If the url filter should be used',
							type: ApplicationCommandOptionType.Boolean,
							required: false,
						},
						{
							name: 'global',
							description: 'If malicious domains should be filtered',
							type: ApplicationCommandOptionType.Boolean,
							required: false,
						},
						{
							name: 'invites',
							description: 'If the invites filter should be used',
							type: ApplicationCommandOptionType.Boolean,
							required: false,
						},
					],
				},
			],
		},
		{
			name: 'invites',
			description: 'Allows you to manage your local invite filters',
			type: ApplicationCommandOptionType.SubcommandGroup,
			options: [
				{
					name: 'allow',
					description: 'Adds the given guild to the allow list',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'guild',
							description: 'The guild to allow',
							type: ApplicationCommandOptionType.String,
							required: true,
						},
					],
				},
				{
					name: 'unallow',
					description: 'Removes the given guild from the allow list',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'guild',
							description: 'The guild to remove from the allow list',
							type: ApplicationCommandOptionType.String,
							required: true,
						},
					],
				},
				{
					name: 'list',
					description: 'Lists all the allowed guilds',
					type: ApplicationCommandOptionType.Subcommand,
					options: [],
				},
			],
		},
		{
			name: 'urls',
			description: 'Allows you to manage your local url filters',
			type: ApplicationCommandOptionType.SubcommandGroup,
			options: [
				{
					name: 'allow',
					description: 'Adds the given domains to the allowlist',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'entry',
							description: 'The entry to allow',
							type: ApplicationCommandOptionType.String,
							required: true,
						},
					],
				},
				{
					name: 'unallow',
					description: 'Removes the given domains from the allowlist',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'entry',
							description: 'The entry to remove from the allowlist',
							type: ApplicationCommandOptionType.String,
							required: true,
						},
					],
				},
				{
					name: 'list',
					description: 'Lists all the allowed domains',
					type: ApplicationCommandOptionType.Subcommand,
					options: [],
				},
			],
		},
	],
} as const;
