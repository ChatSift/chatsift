import {
	INJECTION_TOKENS,
	UserActionValidatorFactory,
	parseRelativeTime,
	type IRestrictModAction,
	type RestrictCaseCreateData,
} from '@automoderator/core';
import {
	API,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	MessageFlags,
	PermissionFlagsBits,
} from '@discordjs/core';
import { inject, injectable } from 'inversify';
import { InteractionsService, type CommandHandler, type Handler } from '../interactions.js';

@injectable()
export default class Punishments implements Handler {
	public constructor(
		private readonly interactions: InteractionsService,
		private readonly api: API,
		private readonly userActionValidatorFactory: UserActionValidatorFactory,
		@inject(INJECTION_TOKENS.actions.restrict) private readonly action: IRestrictModAction,
	) {}

	public register() {
		this.interactions.register({
			interactions: [
				{
					name: 'restrict',
					description: 'Restrict a user (assign a special, manually configured role to them)',
					type: ApplicationCommandType.ChatInput,
					dm_permission: false,
					default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
					options: [
						{
							name: 'target',
							description: 'The user to restrict',
							type: ApplicationCommandOptionType.User,
							required: true,
						},
						{
							name: 'role',
							description: 'The role to assign to the user',
							type: ApplicationCommandOptionType.Role,
							required: true,
						},
						{
							name: 'reason',
							description: 'The reason for restricting the user',
							type: ApplicationCommandOptionType.String,
							required: false,
						},
						{
							name: 'clean',
							description: "Whether or not to remove the other user's roles for the duration of this action",
							type: ApplicationCommandOptionType.Boolean,
							required: false,
						},
						{
							name: 'duration',
							description: 'How long this action should last for',
							type: ApplicationCommandOptionType.String,
							required: false,
							autocomplete: true,
						},
					],
				},
			],
			commands: [['restrict:none:none', this.handleRestrict]],
		});
	}

	private readonly handleRestrict: CommandHandler = async (interaction, options) => {
		const target = options.getUser('target', true);

		const actionValidator = this.userActionValidatorFactory.build({
			guild: interaction.guild_id!,
			moderator: interaction.member!,
			target,
		});

		const validationResult = await actionValidator.targetIsActionable();
		if (!validationResult.ok) {
			return this.api.interactions.reply(interaction.id, interaction.token, {
				content: validationResult.reason,
				flags: MessageFlags.Ephemeral,
			});
		}

		let duration = null;
		const durationStr = options.getString('duration');
		if (durationStr) {
			const parsed = parseRelativeTime(durationStr);
			if (!parsed.ok) {
				return this.api.interactions.reply(interaction.id, interaction.token, {
					content: `Failed to parse provided duration: ${parsed.error}`,
					flags: MessageFlags.Ephemeral,
				});
			}

			duration = parsed.value;
		}

		const data: RestrictCaseCreateData = {
			guildId: interaction.guild_id!,
			modId: interaction.member!.user.id,
			reason: options.getString('reason'),
			targetId: target.id,
			clean: options.getBoolean('clean', true),
			roleId: options.getRole('role', true).id,
			expiresAt: duration ? new Date(Date.now() + duration) : null,
		};

		const cs = await this.action.execute(data);
		await this.action.notify(data);

		// TODO: Logging
		await this.api.interactions.reply(interaction.id, interaction.token, {
			content: 'Successfully restricted user.',
			flags: MessageFlags.Ephemeral,
		});
	};
}
