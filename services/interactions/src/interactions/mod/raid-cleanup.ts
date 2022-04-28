import { ApplicationCommandOptionType, PermissionFlagsBits } from 'discord-api-types/v9';

export const RaidCleanupCommand = {
	name: 'raid-cleanup',
	description: 'Cleans up a recent raid by using an account age-join age relationship',
	default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
	options: [
		{
			name: 'join',
			description: 'How long should a member have been in the server for the cleanup to ignore them',
			type: ApplicationCommandOptionType.String,
			required: false,
		},
		{
			name: 'age',
			description: "How old should a member's account be for the cleanup to ignore them",
			type: ApplicationCommandOptionType.String,
			required: false,
		},
		{
			name: 'ban',
			description: 'Makes the bot ban the raid bots instead of kicking them',
			type: ApplicationCommandOptionType.Boolean,
			required: false,
		},
	],
} as const;
