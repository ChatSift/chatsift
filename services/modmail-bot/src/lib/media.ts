import { Buffer } from 'node:buffer';
import type { Logger } from '@chatsift/backend-core';
import { CDNRoutes, ImageFormat, RouteBases, StickerFormatType } from '@discordjs/core';
import type { RawFile } from '@discordjs/rest';

/**
 * Narrowed to just what this file reads off a real `APIAttachment`/`APIStickerItem` — a forwarded
 * message's `message_snapshots[].message` (see `messageContext.ts`'s `MessageLike`) carries a reduced
 * payload shape, so keeping this minimal lets both it and a live gateway message satisfy the same type
 * without faking an entire `APIAttachment`/`APIStickerItem` for the snapshot case.
 */
export interface RelayAttachmentLike {
	content_type?: string | undefined;
	filename: string;
	size: number;
	url: string;
}

export interface RelayStickerLike {
	format_type: StickerFormatType;
	id: string;
	name: string;
}

/**
 * Conservative stand-in for "the destination channel's actual upload limit" (which depends on the
 * guild's boost tier and isn't worth an extra API call to check) — Discord's default, non-boosted
 * limit. Anything bigger skips re-upload and falls back to a plain link instead of risking a failed
 * relay over one oversized file.
 */
const MAX_REUPLOAD_BYTES = 10 * 1_024 * 1_024;

/**
 * Discord enforces the upload limit against the *combined* size of every file on a single message,
 * not per-file — so re-uploading several attachments that individually pass the per-file check above
 * could still add up to a request Discord rejects outright. Reuses the same conservative bound as the
 * per-file budget.
 */
const MAX_TOTAL_REUPLOAD_BYTES = MAX_REUPLOAD_BYTES;

/**
 * Keeps the failed-links note bounded — an embed description has a hard 4,096 character cap shared
 * with the actual message content, and a ticket with many oversized/failed attachments could otherwise
 * blow past that on its own.
 */
const MAX_FAILED_LINKS_SHOWN = 5;

export interface RelayMedia {
	/**
	 * `attachment://<name>` reference for the first successfully-fetched image, if any — for `APIEmbed#image`.
	 */
	embedImageRef: string | undefined;
	/**
	 * Every attachment/sticker that was actually re-uploaded, to pass as `files` on the relayed message.
	 */
	files: RawFile[];
	/**
	 * Human-readable note about anything that couldn't be forwarded, to append to the embed description.
	 */
	note: string | undefined;
}

async function fetchAsRawFile(
	url: string,
	name: string,
	contentType: string | undefined,
	logger: Logger,
): Promise<{ file: RawFile; size: number } | undefined> {
	try {
		const res = await fetch(url);
		if (!res.ok) {
			throw new Error(`unexpected status ${res.status}`);
		}

		// Real Discord attachments/stickers always pass a `contentType` in already -- this fallback only
		// matters for a snippet's staff-pasted URL, which has no Discord-verified metadata up front.
		const resolvedContentType = contentType ?? res.headers.get('content-type') ?? undefined;

		const data = Buffer.from(await res.arrayBuffer());
		return {
			file: { data, name, ...(resolvedContentType ? { contentType: resolvedContentType } : {}) },
			size: data.length,
		};
	} catch (error) {
		logger.warn({ err: error, url }, 'Failed to fetch media for relay, falling back to a link');
		return undefined;
	}
}

function isImageContentType(contentType: string | undefined): boolean {
	return contentType?.startsWith('image/') ?? false;
}

/**
 * Actually re-uploads attachments and stickers on the relayed message instead of just linking the
 * original CDN url — prod ChatSift/ModMail only ever forwarded a single image by url and dropped
 * everything else (extra attachments, any non-image file, stickers entirely). Re-uploading means
 * every attachment survives even after the source message/thread is gone.
 *
 * Stickers are fetched via their own `format_type`'s CDN extension (there is no working "always
 * transcode to gif" route — that was tried and just broke fetching for every sticker, including
 * previously-fine static ones). PNG/APNG both download as `.png`; Discord's own APNG bytes are
 * animated, but re-uploading them as a plain attachment loses that (regular attachments don't get
 * the special animated rendering an actual sticker slot has) — that limitation is called out in
 * `note` rather than silently swallowed. GIF-format stickers download and stay animated normally.
 * Lottie (vector, format 3) has no raster the CDN can hand back at all, so it's skipped entirely and
 * also called out in `note`.
 */
export async function buildRelayMedia(
	attachments: RelayAttachmentLike[],
	stickers: RelayStickerLike[],
	logger: Logger,
): Promise<RelayMedia> {
	const fetched: { file: RawFile; isImage: boolean }[] = [];
	const failedLinks: string[] = [];
	const notes: string[] = [];
	let totalBytes = 0;

	for (const attachment of attachments) {
		if (attachment.size > MAX_REUPLOAD_BYTES || totalBytes + attachment.size > MAX_TOTAL_REUPLOAD_BYTES) {
			failedLinks.push(attachment.url);
			continue;
		}

		const fetchResult = await fetchAsRawFile(attachment.url, attachment.filename, attachment.content_type, logger);
		if (!fetchResult) {
			failedLinks.push(attachment.url);
			continue;
		}

		// Re-checked against the *actual* fetched size, not just the caller-declared `attachment.size` --
		// real Discord attachments/stickers always carry an accurate size up front, but a snippet's
		// staff-pasted URL doesn't, so it reports `size: 0` to clear the pre-fetch guard above and relies
		// on this check instead.
		if (fetchResult.size > MAX_REUPLOAD_BYTES) {
			failedLinks.push(attachment.url);
			continue;
		}

		totalBytes += fetchResult.size;
		fetched.push({ file: fetchResult.file, isImage: isImageContentType(fetchResult.file.contentType) });
	}

	for (const sticker of stickers) {
		if (sticker.format_type === StickerFormatType.Lottie) {
			notes.push(`sticker "${sticker.name}" is animated (vector) and can't be forwarded`);
			continue;
		}

		const format = sticker.format_type === StickerFormatType.GIF ? ImageFormat.GIF : ImageFormat.PNG;
		const url = `${RouteBases.cdn}${CDNRoutes.sticker(sticker.id, format)}`;
		const name = `${sticker.name}.${format}`;

		const fetchResult = await fetchAsRawFile(url, name, format === ImageFormat.GIF ? 'image/gif' : 'image/png', logger);
		if (!fetchResult) {
			failedLinks.push(url);
			continue;
		}

		if (totalBytes + fetchResult.size > MAX_TOTAL_REUPLOAD_BYTES) {
			failedLinks.push(url);
			continue;
		}

		totalBytes += fetchResult.size;
		fetched.push({ file: fetchResult.file, isImage: true });
		if (sticker.format_type === StickerFormatType.APNG) {
			notes.push(`sticker "${sticker.name}" is animated but will appear static here`);
		}
	}

	// Discord "claims" whichever file an embed's `image` references out of the same message's
	// attachment list, leaving the rest to render as a separate floating attachment group above it —
	// with 2+ files that looks like two disconnected chunks of media. Only claim one into the embed
	// when it's the *only* file being sent; otherwise leave the embed image slot empty and let every
	// file ride together as Discord's native multi-attachment gallery instead. The footer/author stay
	// untouched either way.
	const embedImageRef =
		fetched.length === 1 && fetched[0]!.isImage ? `attachment://${fetched[0]!.file.name}` : undefined;

	if (failedLinks.length > 0) {
		const shown = failedLinks.slice(0, MAX_FAILED_LINKS_SHOWN);
		const remaining = failedLinks.length - shown.length;
		const suffix = remaining > 0 ? ` (+${remaining} more)` : '';
		notes.push(`couldn't forward ${failedLinks.length} item(s), original link(s): ${shown.join(', ')}${suffix}`);
	}

	return {
		embedImageRef,
		files: fetched.map(({ file }) => file),
		note: notes.length > 0 ? notes.map((part) => `*(${part})*`).join('\n') : undefined,
	};
}
