import type { Logger } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { MessageContextCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIMessageApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from '@discordjs/core';
import { handleReplyWithMessageContextMenu } from '../lib/replyContextMenu.js';

const LABEL = 'Reply';

/**
 * Message context menu counterpart to `/reply-q` -- instead of typing the content fresh, right-click a
 * plain message a staffer already typed directly in a ticket's mod-forum thread to send it as a real
 * (non-anonymous) staff reply and delete the original. See `lib/replyContextMenu.ts` for the shared
 * implementation with `replyWithMessageAnon.ts`.
 */
export default class ReplyWithMessageCommand implements CommandHandler {
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
			false,
			LABEL,
		);
	}
}
