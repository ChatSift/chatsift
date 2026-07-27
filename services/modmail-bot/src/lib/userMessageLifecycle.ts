import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { GatewayMessageUpdateDispatchData } from '@discordjs/core';
import { fetchGuildEmojiIds, resolveContentForRelay } from './emojis.js';
import { buildContextNote, resolveEffectiveContent } from './messageContext.js';
import { identityFooter } from './relay.js';
import {
	buildEditedEmbed,
	EDITED_COLOR,
	isMarkedDeleted,
	isUnknownMessageError,
	markEmbedDeleted,
} from './replyModeration.js';
import { findOpenThreadByUserThreadId, findUserThreadMessageByMessageId } from './threads.js';

/**
 * Handles a user editing a message they'd already sent in their ticket's private thread (#253) --
 * updates the mod-forum log copy to match (text-only, same "carry the image forward as-is" limitation
 * `buildEditedEmbed`'s doc comment already states for `/edit`), then posts a standalone notification so
 * staff don't have to notice the log message's ` • edited` footer suffix to realize something changed.
 *
 * `discord-api-types` types every `APIBaseMessage` field (`author`, `content`, ...) as required, but a
 * real `MESSAGE_UPDATE` payload is a *partial* message -- Discord fires this same event when it
 * backfills a link-unfurl embed onto a message the user never touched, and that patch never bumps
 * `edited_timestamp`. Gating on `edited_timestamp` being set is the difference between a real edit and
 * a phantom "edited" notification firing on every bare URL a user pastes.
 */
export async function handleUserMessageUpdate(
	message: GatewayMessageUpdateDispatchData,
	logger: Logger,
): Promise<void> {
	if (!message.author || message.author.bot || !message.edited_timestamp) {
		return;
	}

	const thread = await findOpenThreadByUserThreadId(message.channel_id);
	if (!thread) {
		return;
	}

	const row = await findUserThreadMessageByMessageId(thread.id, message.id);
	if (!row) {
		return;
	}

	try {
		const logMessage = await getContext().service.client.api.channels.getMessage(
			thread.modThreadId,
			row.guildMessageId,
		);
		const logEmbed = logMessage.embeds[0];
		// No embed at all, or already flagged deleted (a prior `MESSAGE_DELETE` raced ahead of this
		// update, or a mod ran `/delete` on it -- can't happen today since that's staff-reply-only, but
		// cheap to guard against regardless): either way, don't resurrect it via an edit.
		if (!logEmbed || isMarkedDeleted(logEmbed)) {
			return;
		}

		const effective = resolveEffectiveContent(message);
		const guildEmojiIds = await fetchGuildEmojiIds(thread.guildId, getContext().service.client.api, logger);
		const resolvedContent = guildEmojiIds
			? resolveContentForRelay(effective.content, guildEmojiIds)
			: effective.content;
		const contextNote = await buildContextNote(message, effective.isForwarded, thread, logger);
		const newDescription = [contextNote, resolvedContent].filter(Boolean).join('\n\n');
		const oldDescription = logEmbed.description ?? '*(no content)*';

		await getContext().service.client.api.channels.editMessage(thread.modThreadId, row.guildMessageId, {
			embeds: [buildEditedEmbed(logEmbed, newDescription, true)],
		});

		const jumpLink = `https://discord.com/channels/${thread.guildId}/${thread.modThreadId}/${row.guildMessageId}`;
		await getContext().service.client.api.channels.createMessage(thread.modThreadId, {
			embeds: [
				{
					color: EDITED_COLOR,
					description: [
						'📝 *Message edited*',
						`**Before:**\n~~${oldDescription}~~`,
						`**After:**\n${newDescription || '*(no content)*'}`,
						`🔗 [Jump to message](${jumpLink})`,
					].join('\n\n'),
					footer: identityFooter(message.author),
				},
			],
		});

		logger.info({ threadId: thread.id }, 'Relayed a user message edit to the mod thread');
	} catch (error) {
		if (isUnknownMessageError(error)) {
			logger.debug({ threadId: thread.id }, 'Mod-side copy of an edited user message is already gone');
			return;
		}

		logger.error({ err: error, threadId: thread.id }, 'Failed to relay a user message edit to the mod thread');
	}
}

/**
 * Handles a user deleting a message they'd already sent in their ticket's private thread (#253) --
 * `MESSAGE_DELETE` carries no author, so `findUserThreadMessageByMessageId`'s `staff_id IS NULL` filter
 * is what confirms this was the user's own message rather than a relayed staff-reply copy sitting in
 * the same thread. Mirrors `/delete`'s own convention exactly, just triggered by the user's client
 * instead of a mod command, and blaming the row's `user_id` instead of a staff id -- reusing
 * `markEmbedDeleted` as-is still reads correctly, since it names whoever it's given as the deleter.
 */
export async function handleUserMessageDelete(channelId: string, messageId: string, logger: Logger): Promise<void> {
	const thread = await findOpenThreadByUserThreadId(channelId);
	if (!thread) {
		return;
	}

	const row = await findUserThreadMessageByMessageId(thread.id, messageId);
	if (!row) {
		return;
	}

	try {
		const logMessage = await getContext().service.client.api.channels.getMessage(
			thread.modThreadId,
			row.guildMessageId,
		);
		const logEmbed = logMessage.embeds[0];
		if (!logEmbed || isMarkedDeleted(logEmbed)) {
			return;
		}

		await getContext().service.client.api.channels.editMessage(thread.modThreadId, row.guildMessageId, {
			embeds: [markEmbedDeleted(logEmbed, row.userId)],
		});

		logger.info({ threadId: thread.id }, "Marked a user's deleted message as deleted in the mod thread");
	} catch (error) {
		if (isUnknownMessageError(error)) {
			logger.debug({ threadId: thread.id }, 'Mod-side copy of a deleted user message is already gone');
			return;
		}

		logger.error(
			{ err: error, threadId: thread.id },
			"Failed to mark a user's deleted message as deleted in the mod thread",
		);
	}
}
