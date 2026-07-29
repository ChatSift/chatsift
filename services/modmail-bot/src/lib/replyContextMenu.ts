import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { APIMessageApplicationCommandInteraction } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { buildForeignEmojiRejection, fetchGuildEmojiIds, findForeignEmojiTokens } from './emojis.js';
import { resolveEffectiveContent } from './messageContext.js';
import { relayStaffReplyToUserThread } from './relay.js';
import { isUnknownMessageError } from './replyModeration.js';
import { findOpenThreadByModThreadId } from './threads.js';

/**
 * Shared by the `Reply` / `Reply Anonymously` message context menu commands (only their `anon` value and
 * user-facing label differ) -- takes a plain message a staff member typed directly in a ticket's
 * mod-forum thread (the `is_internal` case `relay.ts#recordInternalModMessage` records) and turns it into
 * a real staff reply via the same `relayStaffReplyToUserThread` path `/reply`/`/reply-q` use, then deletes
 * the original so it doesn't sit there duplicated as both a plain note and a relayed reply. The delete is
 * what actually reaches the mod-forum thread's `MessageDelete` listener
 * (`lib/userMessageLifecycle.ts#handleInternalMessageDelete`), which already cleans up the recorded
 * internal-message row on its own -- nothing extra to do here for that.
 */
export async function handleReplyWithMessageContextMenu(
	interaction: APIMessageApplicationCommandInteraction,
	logger: Logger,
	anon: boolean,
	commandLabel: string,
): Promise<void> {
	if (!interaction.guild_id || !interaction.channel || !interaction.member) {
		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: 'This can only be used in a server.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const thread = await findOpenThreadByModThreadId(interaction.channel.id);
	if (!thread) {
		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: 'This can only be used on a message inside an open ModMail ticket thread.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const target = interaction.data.resolved.messages[interaction.data.target_id];
	if (!target) {
		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: "Couldn't find that message. Please try again.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Every message the bot itself posts into a mod-forum thread (a relayed user message, a `/reply` log
	// copy, ...) is bot-authored -- the only human-authored messages in that channel are plain staff notes,
	// exactly what this command exists to convert. Rejecting bot messages outright also rules out ever
	// trying to re-relay an embed-only message, which has no plain `content` to send.
	if (target.author.bot) {
		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: `${commandLabel} only works on a plain message a staff member typed directly in this thread, not one the bot posted.`,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const effective = resolveEffectiveContent(target);
	if (!effective.content.trim() && effective.attachments.length === 0) {
		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: "That message has no text or attachments to send, so there's nothing to reply with.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const guildEmojiIds = await fetchGuildEmojiIds(interaction.guild_id, getContext().service.client.api, logger);
	if (!guildEmojiIds) {
		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: "⚠️ Couldn't verify this server's emotes right now. Please try again in a moment.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const foreignEmojiTokens = findForeignEmojiTokens(effective.content, guildEmojiIds);
	if (foreignEmojiTokens.length > 0) {
		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			...buildForeignEmojiRejection(foreignEmojiTokens, effective.content),
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Deferred only once every rejectable-without-side-effects check above has passed -- same reasoning as
	// `commands/reply.ts`: the relay (media re-upload + two message posts) plus the delete below easily
	// outlast Discord's 3-second ack window.
	await getContext().service.client.api.interactions.defer(interaction.id, interaction.token, {
		flags: MessageFlags.Ephemeral,
	});

	try {
		await relayStaffReplyToUserThread({
			anon,
			attachments: effective.attachments,
			content: effective.content,
			logger,
			staffMember: interaction.member,
			staffUser: interaction.member.user,
			thread,
		});
	} catch (error) {
		logger.error({ err: error, threadId: thread.id }, `Failed to relay a "${commandLabel}" reply`);
		await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
			content: '❌ Failed to send that reply. Please try again or reach out for support.',
		});
		return;
	}

	try {
		await getContext().service.client.api.channels.deleteMessage(thread.modThreadId, target.id, {
			reason: `Converted to a reply via "${commandLabel}" by ${interaction.member.user.id}`,
		});
	} catch (error) {
		// The reply already went out successfully at this point -- a failure here (including the target
		// having already been deleted by someone/something else) shouldn't be reported as the command
		// having failed, just logged so the leftover original message doesn't go unnoticed.
		if (!isUnknownMessageError(error)) {
			logger.warn(
				{ err: error, threadId: thread.id },
				'Failed to delete the original message after converting it to a reply',
			);
		}
	}

	await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
		content: '✅ Reply sent.',
	});
}
