import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const ConfigNsfwDetectionCommand = {
	name: 'config-nsfw-detection',
	description: 'Configure NSFW detection thresholds',
	default_member_permissions: String(PermissionFlagsBits.ManageGuild),
	options: [
		{
			name: 'hentai',
			description: 'Configure hentai confidence threshold (number from 0 to 100)',
			type: ApplicationCommandOptionType.Integer,
			required: false,
			min_value: 0,
			max_value: 100,
		},
		{
			name: 'porn',
			description: 'Configure porn confidence threshold (number from 0 to 100)',
			type: ApplicationCommandOptionType.Integer,
			required: false,
			min_value: 0,
			max_value: 100,
		},
		{
			name: 'sexy',
			description: 'Configure sexy confidence threshold (number from 0 to 100)',
			type: ApplicationCommandOptionType.Integer,
			required: false,
			min_value: 0,
			max_value: 100,
		},
	],
} as const;
