import { WarnPunishmentAction } from '@prisma/client';
import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const ConfigWarnPunishmentsCommand = {
	name: 'config-warn-punishments',
	description: 'Manage warn punishments',
	options: [
		{
			name: 'add',
			description: 'Creates a new warn punishment',
			type: ApplicationCommandOptionType.Subcommand,
			options: [
				{
					name: 'count',
					description: 'How many warns are needed to trigger this punishment',
					type: ApplicationCommandOptionType.Integer,
					required: true,
				},
				{
					name: 'punishment',
					description: 'The punishment to apply',
					type: ApplicationCommandOptionType.String,
					required: true,
					choices: [
						{ name: 'mute', value: WarnPunishmentAction.mute },
						{ name: 'ban', value: WarnPunishmentAction.ban },
						{ name: 'kick', value: WarnPunishmentAction.kick },
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
			description: 'Deletes a warn punishment',
			type: ApplicationCommandOptionType.Subcommand,
			options: [
				{
					name: 'count',
					description: 'How many warns were being used to trigger this action',
					type: ApplicationCommandOptionType.Integer,
					required: true,
				},
			],
		},
		{
			name: 'list',
			description: 'Lists all the existing warn punishments',
			type: ApplicationCommandOptionType.Subcommand,
			options: [],
		},
	],
} as const;
