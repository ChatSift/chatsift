import { snowflakeTimestampMs } from '@chatsift/core';

/**
 * `/purge`'s message selection (P6, feature 24), kept apart from the command that runs it.
 *
 * Pure, and deliberately so: every one of these filters is a rule about which of somebody's messages get
 * destroyed, which is the last place in this bot where "it looked right when I tried it" is good enough. The
 * command does the fetching and the deleting; everything that *decides* is here and is unit-tested.
 */

/**
 * The most messages one invocation may delete. Legacy's cap, kept -- five bulk-delete calls is about as much as
 * a moderator who got their filters wrong can undo by hand.
 */
export const PURGE_MAX_AMOUNT = 500;

/**
 * How deep into the channel's history one invocation will look for matches. Distinct from the cap above,
 * because the two answer different questions: `amount` is how many messages may be deleted, this is how many
 * may be *read* to find them. Without it, `/purge user:@somebody` in a channel where they last spoke a year ago
 * would page backwards through the entire channel.
 */
export const PURGE_MAX_SCAN = 1_000;

/**
 * How far back Discord's bulk-delete endpoint will go. Not ours -- it rejects a batch containing anything older
 * than two weeks, and the rejection takes the whole batch with it, so the cutoff is applied when selecting
 * rather than discovered when deleting.
 */
export const PURGE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

/**
 * Discord's own ceiling on one bulk delete.
 */
export const BULK_DELETE_MAX = 100;

export type PurgeMediaKind = 'all' | 'embeds' | 'gifs' | 'images' | 'videos';

/**
 * The parts of a message this filtering reads. Structural rather than `APIMessage` for the reason
 * `messageCache.ts` gives about its own input type -- naming the fields documents the dependency, and keeps the
 * tests from having to build a whole message.
 */
export interface PurgeableMessage {
	readonly attachments: readonly { readonly content_type?: string | undefined; readonly filename: string }[];
	readonly author: { readonly bot?: boolean | undefined; readonly id: string };
	readonly content: string;
	readonly embeds: readonly unknown[];
	readonly id: string;
	readonly webhook_id?: string | undefined;
}

export interface PurgeCriteria {
	/**
	 * Only messages from this member.
	 */
	readonly authorId?: string | undefined;
	/**
	 * Only messages from bots and webhooks.
	 */
	readonly botsOnly?: boolean | undefined;
	/**
	 * Only messages whose content contains this text, case-insensitively. Legacy matched case-sensitively,
	 * which quietly missed the capitalised half of whatever somebody was trying to clean up.
	 */
	readonly includes?: string | undefined;
	readonly media?: PurgeMediaKind | undefined;
	/**
	 * Only messages posted after this message id (`start`).
	 */
	readonly newerThanId?: string | undefined;
	/**
	 * Only messages posted before this message id (`end`).
	 */
	readonly olderThanId?: string | undefined;
}

const MEDIA_EXTENSIONS = {
	gifs: ['gif', 'apng'],
	images: ['png', 'jpg', 'jpeg', 'webp'],
	videos: ['mp4', 'webm', 'mov'],
} as const satisfies Record<string, readonly string[]>;

type MediaGroup = keyof typeof MEDIA_EXTENSIONS;

/**
 * One regex per extension, built once. Legacy compiled these inside the filter callback, so a 500-message purge
 * built the same dozen regexes five hundred times.
 */
const LINK_PATTERNS = new Map<string, RegExp>(
	Object.values(MEDIA_EXTENSIONS)
		.flat()
		.map((extension) => [extension, new RegExp(String.raw`https?://\S+\.${extension}\b`, 'i')]),
);

function hasExtension(message: PurgeableMessage, group: MediaGroup): boolean {
	const extensions: readonly string[] = MEDIA_EXTENSIONS[group];

	// The filename, not the URL. Legacy tested `attachment.url.endsWith('.png')`, which stopped working the day
	// Discord started signing CDN links -- every attachment URL now ends in `?ex=...&is=...&hm=...`, so the
	// media filter had been quietly matching nothing but links typed into the message body.
	const attachmentMatch = message.attachments.some((attachment) => {
		const extension = attachment.filename.split('.').pop()?.toLowerCase();
		return extension !== undefined && extensions.includes(extension);
	});

	if (attachmentMatch) {
		return true;
	}

	return extensions.some((extension) => LINK_PATTERNS.get(extension)!.test(message.content));
}

function hasMedia(message: PurgeableMessage, kind: PurgeMediaKind): boolean {
	if (kind === 'embeds') {
		return message.embeds.length > 0;
	}

	if (kind === 'all') {
		return (
			message.embeds.length > 0 ||
			(Object.keys(MEDIA_EXTENSIONS) as MediaGroup[]).some((group) => hasExtension(message, group))
		);
	}

	return hasExtension(message, kind);
}

/**
 * Whether one message is in scope for a purge.
 *
 * Every criterion narrows -- there is no "or". A purge is destructive and unattended, so the combination a
 * moderator types has to mean *fewer* messages than any one of its parts, never more.
 */
export function matchesPurgeCriteria(message: PurgeableMessage, criteria: PurgeCriteria, now = Date.now()): boolean {
	// First, because it is the one Discord enforces rather than us: a batch containing anything this old is
	// rejected in its entirety.
	if (now - snowflakeTimestampMs(message.id) >= PURGE_MAX_AGE_MS) {
		return false;
	}

	if (criteria.botsOnly && !message.author.bot && message.webhook_id === undefined) {
		return false;
	}

	if (criteria.authorId !== undefined && message.author.id !== criteria.authorId) {
		return false;
	}

	if (criteria.includes !== undefined && !message.content.toLowerCase().includes(criteria.includes.toLowerCase())) {
		return false;
	}

	// Snowflakes compare as integers, and BigInt says so exactly. Legacy compared the millisecond timestamps
	// they decode to, which ties two messages posted inside the same millisecond.
	if (criteria.newerThanId !== undefined && BigInt(message.id) <= BigInt(criteria.newerThanId)) {
		return false;
	}

	if (criteria.olderThanId !== undefined && BigInt(message.id) >= BigInt(criteria.olderThanId)) {
		return false;
	}

	if (criteria.media !== undefined && !hasMedia(message, criteria.media)) {
		return false;
	}

	return true;
}

/**
 * Whether paging further back can still turn up anything in scope.
 *
 * Messages arrive newest-first, so the two bounds that are *ordered* -- the two-week ceiling and `start` -- are
 * also the two that let a scan stop early rather than reading its full budget to find nothing. Called with the
 * oldest message of each page.
 */
export function isPastPurgeRange(oldest: PurgeableMessage, criteria: PurgeCriteria, now = Date.now()): boolean {
	if (now - snowflakeTimestampMs(oldest.id) >= PURGE_MAX_AGE_MS) {
		return true;
	}

	return criteria.newerThanId !== undefined && BigInt(oldest.id) <= BigInt(criteria.newerThanId);
}

/**
 * The ids to delete, newest first, capped at `amount`.
 */
export function selectPurgeTargets(
	messages: readonly PurgeableMessage[],
	criteria: PurgeCriteria,
	amount: number,
	now = Date.now(),
): string[] {
	const selected: string[] = [];

	for (const message of messages) {
		if (selected.length >= amount) {
			break;
		}

		if (matchesPurgeCriteria(message, criteria, now)) {
			selected.push(message.id);
		}
	}

	return selected;
}

/**
 * Splits the selection into bulk-delete-sized batches.
 */
export function chunkForBulkDelete(ids: readonly string[]): string[][] {
	const chunks: string[][] = [];

	for (let index = 0; index < ids.length; index += BULK_DELETE_MAX) {
		chunks.push(ids.slice(index, index + BULK_DELETE_MAX));
	}

	return chunks;
}
