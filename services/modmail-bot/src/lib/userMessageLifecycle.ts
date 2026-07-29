import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { GatewayMessageUpdateDispatchData } from '@discordjs/core';
import { fetchGuildEmojiIds, resolveContentForRelay } from './emojis.js';
import { withMessageLock } from './guildUserQueue.js';
import { buildContextNote, resolveEffectiveContent } from './messageContext.js';
import { identityFooter } from './relay.js';
import {
	buildEditedEmbed,
	EDITED_COLOR,
	isMarkedDeleted,
	isUnknownMessageError,
	markEmbedDeleted,
} from './replyModeration.js';
import {
	deleteInternalThreadMessage,
	findModThreadMessageByMessageId,
	findOpenThreadByModThreadId,
	findOpenThreadByUserChannelId,
	findUserThreadMessageByMessageId,
	markUserThreadMessageDeleted,
	updateRecordedMessageContent,
} from './threads.js';

/**
 * Handles a user editing a message they'd already sent in their ticket's private thread (#253) --
 * updates the mod-forum log copy to match (text-only, same "carry the image forward as-is" limitation
 * `buildEditedEmbed`'s doc comment already states for `/edit`), then posts a standalone notification so
 * staff don't have to notice the log message's ` • edited` footer suffix to realize something changed.
 *
 * `discord-api-types` types every `APIBaseMessage` field (`author`, `content`, ...) as required, but a
 * real `MESSAGE_UPDATE` payload is a *partial* message -- Discord fires this same event when it
 * backfills a link-unfurl embed onto a message the user never touched, and that patch never bumps
 * `edited_timestamp`, and a partial patch that changed something *other* than content can omit `content`
 * entirely. Gating on `edited_timestamp` being set filters out the former (the difference between a real
 * edit and a phantom "edited" notification firing on every bare URL a user pastes); gating on `content`
 * actually being a string (despite the type claiming it always is) guards the latter.
 */
export async function handleUserMessageUpdate(
	message: GatewayMessageUpdateDispatchData,
	logger: Logger,
): Promise<void> {
	// Pulled into standalone consts rather than read off `message` repeatedly -- same reasoning as
	// `commands/edit.ts`'s `userChannelId` const: narrowing a plain object *property* isn't guaranteed to
	// persist across the `await`s (and the nested closure) below the way a narrowed local variable is.
	const author = message.author;
	const content = message.content;
	if (!author || author.bot || !message.edited_timestamp || typeof content !== 'string') {
		return;
	}

	const thread = await findOpenThreadByUserChannelId(message.channel_id);
	if (!thread) {
		return;
	}

	const row = await findUserThreadMessageByMessageId(thread.id, message.id);
	if (!row) {
		return;
	}

	try {
		// Serialized against `handleUserMessageDelete` below on the same mod-side message id -- both
		// handlers read-then-write the log embed, and a user editing a message and immediately deleting
		// it (or vice versa) can otherwise interleave the two, letting a slow edit's write clobber a
		// delete's "deleted" mark once it lands after. See `withMessageLock`'s doc comment.
		await withMessageLock(row.guildMessageId, async () => {
			const logMessage = await getContext().service.client.api.channels.getMessage(
				thread.modThreadId,
				row.guildMessageId,
			);
			const logEmbed = logMessage.embeds[0];
			// No embed at all, or already flagged deleted (the user deleted this same message in the gap
			// between the edit and this lock being acquired): either way, don't resurrect it via an edit.
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

			// No-op if this message predates recording being enabled, or if recording has since been turned
			// back off for the guild (both checked atomically inside `updateRecordedMessageContent` itself).
			// The prior content is archived into `thread_message_content_edits` before being overwritten to
			// match whatever the mod-forum log embed now shows -- see that function's own doc comment.
			// Recorded as `effective.content` (the raw text), not `resolvedContent` -- see
			// `relay.ts#relayUserMessageToModThread`'s matching comment on why the foreign-emoji-to-hyperlink
			// downgrade is a live-Discord-embed-only concern, not something the dashboard's own renderer needs.
			await updateRecordedMessageContent(thread.guildId, row.id, effective.content);

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
						footer: identityFooter(author),
					},
				],
			});

			logger.info({ threadId: thread.id }, 'Relayed a user message edit to the mod thread');
		});
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
	const thread = await findOpenThreadByUserChannelId(channelId);
	if (!thread) {
		return;
	}

	const row = await findUserThreadMessageByMessageId(thread.id, messageId);
	if (!row) {
		return;
	}

	// Persisted before anything Discord-facing below -- purely a DB fact ("this message was deleted"),
	// independent of whether the mod-forum log embed can still be reached/edited (Phase 3, #261). The
	// recorded `thread_message_content` itself is never touched -- see `markUserThreadMessageDeleted`'s
	// own doc comment for why this is a display-only marker, not a content change.
	await markUserThreadMessageDeleted(row.id);

	try {
		// See `handleUserMessageUpdate`'s matching comment -- serializes against it on the same mod-side
		// message id so a fast edit-then-delete (or delete-then-edit) can't have one handler's write
		// clobber the other's.
		await withMessageLock(row.guildMessageId, async () => {
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
		});
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

/**
 * Mod-thread counterpart to `handleUserMessageUpdate`, for Phase 3 (#261): a plain message posted directly
 * in a ticket's mod-forum thread (recorded as an `is_internal` row by `recordInternalModMessage`, see
 * `relay.ts`) that a mod then edits via Discord's own UI. Unlike the user-thread side, there's no mod-forum
 * log embed to keep in sync (the message *is* the log -- it was never relayed anywhere), so this only
 * needs to update the recorded copy, silently -- same reasoning as `recordInternalModMessage` itself never
 * posting any notification for internal chatter.
 */
export async function handleInternalMessageUpdate(
	message: GatewayMessageUpdateDispatchData,
	logger: Logger,
): Promise<void> {
	const author = message.author;
	const content = message.content;
	if (!author || author.bot || !message.edited_timestamp || typeof content !== 'string') {
		return;
	}

	const thread = await findOpenThreadByModThreadId(message.channel_id);
	if (!thread) {
		return;
	}

	const row = await findModThreadMessageByMessageId(thread.id, message.id);
	if (!row) {
		return;
	}

	try {
		const effective = resolveEffectiveContent(message);

		// No emoji-substitution concern here unlike the user-thread side (`handleUserMessageUpdate`) --
		// this message was never relayed anywhere by the bot, a mod posted it directly into the mod-forum
		// thread with their own client, so Discord already rendered whatever emoji it contains correctly.
		// Nothing here is Discord-facing at all, just the recorded copy, so there's nothing to resolve.
		//
		// No-op if this predates recording, or recording has since been disabled (checked atomically inside
		// `updateRecordedMessageContent`) -- same archive-then-overwrite behavior as the user-thread side.
		await updateRecordedMessageContent(thread.guildId, row.id, effective.content);

		logger.info({ threadId: thread.id }, 'Updated recorded content for an edited internal mod-thread message');
	} catch (error) {
		logger.error(
			{ err: error, threadId: thread.id },
			'Failed to update recorded content for an edited internal message',
		);
	}
}

/**
 * Mod-thread counterpart to `handleUserMessageDelete`, for Phase 3 (#261) -- but deliberately asymmetric:
 * a mod deleting their own internal note is a true delete (`deleteInternalThreadMessage`), not the
 * "survives, marked deleted" treatment user-facing messages get. Internal chatter was never part of the
 * durable user-facing exchange the "mod-forum thread is the record" principle protects (see the Decisions
 * section of docs/roadmap/07-modmail-thread-history.md), so there's nothing here worth keeping a trace of.
 * No Discord-side work needed either -- the message is already gone, and nothing was ever relayed
 * elsewhere for it to be marked deleted on.
 */
export async function handleInternalMessageDelete(channelId: string, messageId: string, logger: Logger): Promise<void> {
	const thread = await findOpenThreadByModThreadId(channelId);
	if (!thread) {
		return;
	}

	try {
		const deleted = await deleteInternalThreadMessage(thread.id, messageId);
		if (deleted) {
			logger.info({ threadId: thread.id }, 'Deleted a recorded internal mod-thread message');
		}
	} catch (error) {
		logger.error({ err: error, threadId: thread.id }, 'Failed to delete a recorded internal mod-thread message');
	}
}
