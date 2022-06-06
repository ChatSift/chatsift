import { AutomodPunishmentAction } from '@prisma/client';
import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const ConfigAutomodPunishmentsCommand = {
	name: 'config-automod-punishments',
	description: 'Manage automod punishments',
	default_member_permissions: String(PermissionFlagsBits.ManageGuild),
	options: [
		{
			name: 'add',
			description: 'Creates a new automod punishment',
			type: ApplicationCommandOptionType.Subcommand,
			options: [
				{
					name: 'count',
					description: 'How many automod triggers are needed to trigger this punishment',
					type: ApplicationCommandOptionType.Integer,
					required: true,
				},
				{
					name: 'punishment',
					description: 'The punishment to apply',
					type: ApplicationCommandOptionType.String,
					required: true,
					choices: [
						{ name: 'warn', value: AutomodPunishmentAction.warn },
						{ name: 'mute', value: AutomodPunishmentAction.mute },
						{ name: 'ban', value: AutomodPunishmentAction.ban },
						{ name: 'kick', value: AutomodPunishmentAction.kick },
					],
				},
				{
					name: 'duration',
					description: 'Duration of the action',
					type: ApplicationCommandOptionType.String,
				},
			],
		},
		{
			name: 'delete',
			description: 'Deletes an automod punishment',
			type: ApplicationCommandOptionType.Subcommand,
			options: [
				{
					name: 'count',
					description: 'How many automod triggerss were being used to trigger this action',
					type: ApplicationCommandOptionType.Integer,
					required: true,
				},
			],
		},
		{
			name: 'list',
			description: 'Lists all the existing automod punishments',
			type: ApplicationCommandOptionType.Subcommand,
			options: [],
		},
	],
} as const;
