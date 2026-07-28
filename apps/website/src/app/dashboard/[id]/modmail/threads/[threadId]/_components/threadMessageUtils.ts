import type { APIUser, Snowflake } from '@discordjs/core';
import type { ModmailThreadMessage } from '@/api/routes/modmailThreads';
import { discordSnowflakeToDate } from '@/utils/util';

export function participantLabel(entry: APIUser | Snowflake | undefined, fallbackId: string): string {
	if (!entry) {
		return fallbackId;
	}

	return typeof entry === 'string' ? entry : (entry.global_name ?? entry.username);
}

export function messageAuthorId(message: ModmailThreadMessage): string {
	// `staffId` is always the real staff member regardless of `anon` -- `anon` only controls what the *user*
	// sees (relayed as a generic "staff" label in their own thread), never what's recorded here. Staff viewing
	// this dashboard always see who actually sent it, with a badge noting it went out anonymously.
	return message.staffId ?? message.userId;
}

export function isStaffMessage(message: ModmailThreadMessage): boolean {
	return message.staffId !== null;
}

/**
 * The display name a message's author should render under, everywhere one is needed (the message's own
 * header in `ThreadMessage.tsx`, and the reply-preview button pointing at an earlier message) -- a system
 * message with no `staffId` (the greeting, or an anonymized farewell) has no real actor to resolve, so
 * `messageAuthorId` falling back to `userId` would misattribute it to the ticket's own user (that column is
 * always populated even for these rows, see schema.sql's own doc comment). An *attributed* farewell still
 * resolves normally, since `staffId` is genuinely the closer.
 */
export function resolveAuthorLabel(
	message: ModmailThreadMessage,
	participants: Record<string, APIUser | Snowflake>,
): string {
	if (message.isSystem && message.staffId === null) {
		return 'System';
	}

	const authorId = messageAuthorId(message);
	return participantLabel(participants[authorId], authorId);
}

export type RecordedSticker = NonNullable<ModmailThreadMessage['recordedContent']>['stickers'][number];

/**
 * Discord's sticker CDN -- static formats (`PNG`/`APNG`, format types 1/2) are served from the plain
 * CDN host, animated `GIF` stickers (format type 4) only render through the media proxy host. `Lottie`
 * (format type 3, vector animation) has no static image at all -- rendering that properly would need a
 * Lottie player, out of scope for this pass, so it just falls back to a name chip.
 */
export function stickerImageUrl(sticker: RecordedSticker): string | undefined {
	switch (sticker.formatType) {
		case 1:
		case 2:
			return `https://cdn.discordapp.com/stickers/${sticker.id}.png?size=160`;
		case 4:
			return `https://media.discordapp.net/stickers/${sticker.id}.gif?size=160`;
		default:
			return undefined;
	}
}

export type ThreadRenderItem =
	| { message: ModmailThreadMessage; showHeader: boolean; type: 'message' }
	| { messages: ModmailThreadMessage[]; type: 'internal-group' };

/**
 * Discord's own consecutive-message grouping window -- messages from the same author within this long of
 * each other suppress the repeated avatar/name header (Phase 3 must, #261).
 */
const GROUPING_WINDOW_MS = 7 * 60 * 1_000;

/**
 * Reshapes a flat, ascending-order message list into render-ready chunks: consecutive messages from the
 * same author *and the same staff/user role* within `GROUPING_WINDOW_MS` collapse their header
 * (`showHeader: false`) -- the role check matters because a self-testing staff member's own Discord account
 * can be both the ticket's user and the staff replying to it, and those two roles must never visually merge
 * even though `messageAuthorId` alone would consider them "the same author". A *run* of two or more
 * consecutive `is_internal` messages (mod-to-mod chatter between two real relayed messages) collapses into
 * a single collapsible block -- a lone internal message isn't worth hiding behind a click, so it renders
 * inline same as before.
 */
export function buildRenderItems(messages: ModmailThreadMessage[]): ThreadRenderItem[] {
	const items: ThreadRenderItem[] = [];
	let index = 0;

	while (index < messages.length) {
		const message = messages[index]!;

		if (message.isInternal) {
			const run: ModmailThreadMessage[] = [message];
			let next = index + 1;
			while (next < messages.length && messages[next]!.isInternal) {
				run.push(messages[next]!);
				next += 1;
			}

			if (run.length > 1) {
				items.push({ messages: run, type: 'internal-group' });
			} else {
				items.push({ message, showHeader: true, type: 'message' });
			}

			index = next;
			continue;
		}

		const previous = messages[index - 1];
		const showHeader =
			!previous ||
			previous.isInternal ||
			previous.isSystem ||
			message.isSystem ||
			// A forwarded message's only visual indicator lives in the (otherwise-suppressible) header --
			// grouping it under the previous message's header would silently hide that it was forwarded
			// at all, so a forward always starts its own visual block.
			Boolean(message.recordedContent?.isForwarded) ||
			messageAuthorId(previous) !== messageAuthorId(message) ||
			isStaffMessage(previous) !== isStaffMessage(message) ||
			discordSnowflakeToDate(message.guildMessageId).getTime() -
				discordSnowflakeToDate(previous.guildMessageId).getTime() >
				GROUPING_WINDOW_MS;

		items.push({ message, showHeader, type: 'message' });
		index += 1;
	}

	return items;
}
