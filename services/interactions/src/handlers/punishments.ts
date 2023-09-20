import {
	INJECTION_TOKENS,
	UserActionValidatorFactory,
	type IRestrictModAction,
	type RestrictCaseCreateData,
} from '@automoderator/core';
import { API, MessageFlags } from '@discordjs/core';
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
			// TODO: Args
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

		const data: RestrictCaseCreateData = {
			guildId: interaction.guild_id!,
			modId: interaction.member!.user.id,
			reason: options.getString('reason'),
			targetId: target.id,
			clean: options.getBoolean('clean', true),
			roleId: options.getRole('role')!.id,
			// TODO: Support duration
			duration: null,
			expiresAt: null,
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
