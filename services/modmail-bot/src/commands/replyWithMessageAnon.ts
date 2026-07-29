import type { Logger } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { MessageContextCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIMessageApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from '@discordjs/core';
import { handleReplyWithMessageContextMenu } from '../lib/replyContextMenu.js';

const LABEL = 'Reply Anonymously';

/**
 * Anonymous counterpart to `replyWithMessage.ts` -- see that file and `lib/replyContextMenu.ts` for the
 * shared implementation. Only `anon: true` differs.
 */
export default class ReplyWithMessageAnonCommand implements CommandHandler {
	public readonly name = LABEL;

	public readonly data = new MessageContextCommandBuilder()
		.setName(LABEL)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger) {
		await handleReplyWithMessageContextMenu(
			interaction as APIMessageApplicationCommandInteraction,
			logger,
			true,
			LABEL,
		);
	}
}
