import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { APIMessageApplicationCommandInteraction } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { buildForeignEmojiRejection, fetchGuildEmojiIds, findForeignEmojiTokens } from './emojis.js';
import { resolveEffectiveContent } from './messageContext.js';
import { relayStaffReplyToUserThread, UndeliverableUserError } from './relay.js';
import { isUnknownMessageError } from './replyModeration.js';
import { findOpenThreadByModThreadId } from './threads.js';

/**
 * Single-process guard against two concurrent context-menu invocations (either command, or one of each)
 * targeting the *same* message racing each other into a duplicate relay -- `interaction.data.resolved`
 * is a snapshot handed to every invocation independently, so without this, two staff clicking within the
 * same window would both pass every check below and both call `relayStaffReplyToUserThread`. Claimed
 * synchronously (`.has()` immediately followed by `.add()`, no `await` in between) right before the relay
 * call, so there's no interleaving window even without an explicit lock -- Node never preempts a
 * synchronous block. Released on a relay failure so the mod can retry; left claimed on success, since the
 * original message is deleted right after and a stray stale-client re-click on it should still be a no-op
 * rather than a second relay. Never grows unbounded in practice -- one entry per successful conversion,
 * a manual, low-frequency staff action.
 */
const claimedTargetMessageIds = new Set<string>();

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
	// Deferred unconditionally, before any DB/Discord-API round trip below (the thread lookup, and
	// especially `fetchGuildEmojiIds`, which can hit Discord's REST API on a cache miss) -- otherwise
	// those checks are racing Discord's 3-second ack window with nothing acknowledging the interaction
	// yet. Every branch below responds via `editReply` against this defer instead of a fresh `reply`.
	await getContext().service.client.api.interactions.defer(interaction.id, interaction.token, {
		flags: MessageFlags.Ephemeral,
	});

	const editReply = async (content: string) => {
		await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
			content,
		});
	};

	if (!interaction.guild_id || !interaction.channel || !interaction.member) {
		await editReply('This can only be used in a server.');
		return;
	}

	const thread = await findOpenThreadByModThreadId(interaction.channel.id);
	if (!thread) {
		await editReply('This can only be used on a message inside an open ModMail ticket thread.');
		return;
	}

	const target = interaction.data.resolved.messages[interaction.data.target_id];
	if (!target) {
		await editReply("Couldn't find that message. Please try again.");
		return;
	}

	// Every message the bot itself posts into a mod-forum thread (a relayed user message, a `/reply` log
	// copy, ...) is bot-authored -- the only human-authored messages in that channel are plain staff notes,
	// exactly what this command exists to convert. Rejecting bot messages outright also rules out ever
	// trying to re-relay an embed-only message, which has no plain `content` to send.
	if (target.author.bot) {
		await editReply(
			`${commandLabel} only works on a plain message a staff member typed directly in this thread, not one the bot posted.`,
		);
		return;
	}

	const effective = resolveEffectiveContent(target);
	if (!effective.content.trim() && effective.attachments.length === 0) {
		await editReply("That message has no text or attachments to send, so there's nothing to reply with.");
		return;
	}

	const guildEmojiIds = await fetchGuildEmojiIds(interaction.guild_id, getContext().service.client.api, logger);
	if (!guildEmojiIds) {
		await editReply("⚠️ Couldn't verify this server's emotes right now. Please try again in a moment.");
		return;
	}

	const foreignEmojiTokens = findForeignEmojiTokens(effective.content, guildEmojiIds);
	if (foreignEmojiTokens.length > 0) {
		const rejection = buildForeignEmojiRejection(foreignEmojiTokens, effective.content);
		await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
			content: rejection.content,
			...(rejection.files ? { files: rejection.files } : {}),
		});
		return;
	}

	if (claimedTargetMessageIds.has(target.id)) {
		await editReply('This message is already being (or has already been) sent as a reply.');
		return;
	}

	claimedTargetMessageIds.add(target.id);

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
		// Release the claim -- nothing was actually sent, so a retry (running the command again) needs to
		// be possible.
		claimedTargetMessageIds.delete(target.id);

		if (error instanceof UndeliverableUserError) {
			logger.warn({ err: error, threadId: thread.id }, 'Reply could not be delivered to the user');
			await editReply("❌ Couldn't deliver that reply — the user has DMs closed or left the server. Nothing was sent.");
			return;
		}

		logger.error({ err: error, threadId: thread.id }, `Failed to relay a "${commandLabel}" reply`);
		await editReply('❌ Failed to send that reply. Please try again or reach out for support.');
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

	await editReply('✅ Reply sent.');
}
