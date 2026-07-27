import type { Logger } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';
import { MessageReferenceType } from '@discordjs/core';
import type { RelayAttachmentLike, RelayStickerLike } from './media.js';
import { findRepliedToGuildMessageId } from './threads.js';

/**
 * Minimal shape both a live gateway `MESSAGE_CREATE` payload and the `message_snapshots[].message`
 * inside it satisfy — enough to resolve either level of a possibly-forwarded message.
 */
export interface MessageLike {
	attachments: RelayAttachmentLike[];
	content: string;
	message_reference?:
		| {
				message_id?: string | undefined;
				type?: MessageReferenceType | undefined;
		  }
		| undefined;
	message_snapshots?:
		| { message: { attachments: RelayAttachmentLike[]; content: string; sticker_items?: RelayStickerLike[] } }[]
		| undefined;
	sticker_items?: RelayStickerLike[] | undefined;
}

export interface EffectiveMessageContent {
	attachments: RelayAttachmentLike[];
	content: string;
	isForwarded: boolean;
	stickers: RelayStickerLike[];
}

/**
 * Discord's "Forward" feature posts a near-empty message whose actual content lives in
 * `message_snapshots[0].message` instead of on the message itself (`message_reference.type` is
 * `Forward` rather than the `Default` reply type) — reading straight off `message.content`/
 * `.attachments` the way a normal message relay does silently drops a forwarded message entirely.
 */
export function resolveEffectiveContent(message: MessageLike): EffectiveMessageContent {
	const snapshot = message.message_snapshots?.[0]?.message;
	if (message.message_reference?.type === MessageReferenceType.Forward && snapshot) {
		return {
			attachments: snapshot.attachments,
			content: snapshot.content,
			isForwarded: true,
			stickers: snapshot.sticker_items ?? [],
		};
	}

	return {
		attachments: message.attachments,
		content: message.content,
		isForwarded: false,
		stickers: message.sticker_items ?? [],
	};
}

/**
 * A Discord-native reply (the swipe/right-click "Reply" action, not a forward) carries no visual
 * indicator once relayed unless called out explicitly — this resolves the replied-to message back to
 * wherever it was relayed in the mod thread and links straight to it. Our own local message numbering
 * (the "Reply ID: N" footer on staff replies) is never shown to mods on user messages, so referencing
 * a bare number here wouldn't mean anything to them — a link is unambiguous either way.
 */
export async function resolveReplyNote(
	thread: Pick<Threads, 'guildId' | 'id' | 'modThreadId'>,
	message: MessageLike,
	logger: Logger,
): Promise<string | undefined> {
	const reference = message.message_reference;
	if (!reference?.message_id || reference.type === MessageReferenceType.Forward) {
		return undefined;
	}

	try {
		const guildMessageId = await findRepliedToGuildMessageId(thread.id, reference.message_id);
		if (!guildMessageId) {
			return '↩️ *replying to an earlier message*';
		}

		const link = `https://discord.com/channels/${thread.guildId}/${thread.modThreadId}/${guildMessageId}`;
		return `↩️ *replying to [this message](${link})*`;
	} catch (error) {
		logger.warn({ err: error }, 'Failed to resolve reply context for relay');
		return '↩️ *replying to an earlier message*';
	}
}

/**
 * Forwarded messages get their own note (there's no earlier local message number to point at, unlike
 * a reply) -- everything else defers to `resolveReplyNote`, which itself returns `undefined` when the
 * message isn't a reply at all. Shared by both the `MessageCreate` relay and the `MessageUpdate`
 * lifecycle handler (`lib/userMessageLifecycle.ts`) -- a user's edit keeps whatever reply/forward
 * context the original message had, so this is recomputed the same way for both.
 */
export async function buildContextNote(
	message: MessageLike,
	isForwarded: boolean,
	thread: Pick<Threads, 'guildId' | 'id' | 'modThreadId'>,
	logger: Logger,
): Promise<string | undefined> {
	if (isForwarded) {
		return '📨 *Forwarded message*';
	}

	return resolveReplyNote(thread, message, logger);
}
