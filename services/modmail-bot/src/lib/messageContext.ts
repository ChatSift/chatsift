import type { Logger } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';
import { MessageReferenceType } from '@discordjs/core';
import type { RelayAttachmentLike, RelayStickerLike } from './media.js';
import { findRepliedToGuildMessageId } from './threads.js';

/**
 * Just the two text-bearing halves of `APIPoll` — enough to render one, and narrow enough that a real
 * gateway poll object satisfies it structurally without this file depending on the full payload type.
 */
export interface PollLike {
	answers: { poll_media: { text?: string | undefined } }[];
	question: { text?: string | undefined };
}

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
		| {
				message: {
					attachments: RelayAttachmentLike[];
					content: string;
					poll?: PollLike | undefined;
					sticker_items?: RelayStickerLike[] | undefined;
				};
		  }[]
		| undefined;
	poll?: PollLike | undefined;
	sticker_items?: RelayStickerLike[] | undefined;
}

export interface EffectiveMessageContent {
	attachments: RelayAttachmentLike[];
	content: string;
	isForwarded: boolean;
	stickers: RelayStickerLike[];
}

/**
 * A poll lives entirely in its own `poll` object -- a poll message's `content` is empty, so relaying
 * content/attachments/stickers the way everything else does drops it without a trace, which is exactly
 * what a user sending a poll into their ticket used to get. There's nothing to re-post as an actual
 * poll (creating one needs its own message, and a mod-thread copy that could be *voted on* would be
 * actively misleading), so it's flattened into text instead -- the question and its options, which is
 * all the information a poll actually carries for staff reading a ticket.
 *
 * Folded into `content` rather than returned as its own field so it rides along everywhere content
 * already goes -- the relayed embed's description *and* `thread_message_content.text` -- instead of
 * needing every call site to learn about polls.
 */
function renderPoll(poll: PollLike): string {
	const question = poll.question.text?.trim();
	const answers = poll.answers.map((answer) => answer.poll_media.text?.trim()).filter(Boolean);

	// Empty-string question, not just a missing one, has to fall back too -- every field of Discord's poll
	// media object is optional, so a `??` here would happily render an empty header.
	const header = question?.length ? question : '*(no question)*';
	return [`📊 **Poll:** ${header}`, ...answers.map((answer) => `- ${answer}`)].join('\n');
}

function withPoll(content: string, poll: PollLike | undefined): string {
	return poll ? [content, renderPoll(poll)].filter(Boolean).join('\n\n') : content;
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
			content: withPoll(snapshot.content, snapshot.poll),
			isForwarded: true,
			stickers: snapshot.sticker_items ?? [],
		};
	}

	return {
		attachments: message.attachments,
		content: withPoll(message.content, message.poll),
		isForwarded: false,
		stickers: message.sticker_items ?? [],
	};
}

/**
 * The raw Discord message id a (non-forwarded) message is natively replying to, or `undefined` if it
 * isn't a reply at all -- shared by `resolveReplyNote` below and by `relay.ts`'s content-recording path,
 * which needs the same reference id to resolve `thread_message_content.replied_to_thread_message_id`.
 */
export function resolveReplyReferenceId(message: MessageLike): string | undefined {
	const reference = message.message_reference;
	if (!reference?.message_id || reference.type === MessageReferenceType.Forward) {
		return undefined;
	}

	return reference.message_id;
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
	const replyReferenceId = resolveReplyReferenceId(message);
	if (!replyReferenceId) {
		return undefined;
	}

	try {
		const target = await findRepliedToGuildMessageId(thread.id, replyReferenceId);
		if (!target) {
			return '↩️ *replying to an earlier message*';
		}

		const link = `https://discord.com/channels/${thread.guildId}/${thread.modThreadId}/${target.guildMessageId}`;
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
