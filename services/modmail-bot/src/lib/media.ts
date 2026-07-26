import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
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

/**
 * How long a single media fetch (including following redirects) is allowed to take before giving up and
 * falling back to a link — real Discord CDN URLs respond in well under this; a staff-pasted URL to a
 * slow or non-responding host would otherwise tie up the interaction handler indefinitely.
 */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Same rationale as most browsers/HTTP clients -- enough to follow a real redirect chain (e.g. a CDN
 * front door), not enough to be useful as a resource-exhaustion vector via a redirect loop.
 */
const MAX_REDIRECTS = 5;

const IPV4_LITERAL_REGEX = /^(?<a>\d{1,3})\.(?<b>\d{1,3})\.(?<c>\d{1,3})\.(?<d>\d{1,3})$/;

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

/**
 * Mirrors `isSafeAttachmentUrl` in `services/api/src/routes/modmail/schemas.ts` -- kept as a separate
 * copy since this app and `services/api` don't share a validation-utils package (keep the two in sync
 * if either changes). This copy is the *real* enforcement boundary: the API's is just a fast-fail
 * create/update-time UX check, whereas this runs on every actual fetch, including every redirect hop
 * below -- a URL that resolved to something public when a snippet was created could still 302 into an
 * internal address at send time.
 *
 * Only catches IP literals and `localhost`, not a hostname that *resolves* to a private/internal
 * address (no DNS lookup here) -- accepted gap for a staff-gated (guild-manager-only) feature rather
 * than adding a DNS-rebinding-proof dispatcher for this.
 */
function isSafeMediaUrl(url: URL): boolean {
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return false;
	}

	const hostname = url.hostname.toLowerCase().replaceAll(/^\[|]$/g, '');
	if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
		return false;
	}

	const ipv4 = IPV4_LITERAL_REGEX.exec(hostname);
	if (ipv4) {
		const { a: aStr, b: bStr } = ipv4.groups as Record<'a' | 'b' | 'c' | 'd', string>;
		const a = Number(aStr);
		const b = Number(bStr);
		return !(
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}

	if (hostname.includes(':')) {
		return !(hostname === '::1' || hostname === '::' || /^f[cd]/.test(hostname) || /^fe[89ab]/.test(hostname));
	}

	return true;
}

async function fetchAsRawFile(
	url: string,
	name: string,
	contentType: string | undefined,
	logger: Logger,
): Promise<{ file: RawFile; size: number } | undefined> {
	try {
		let currentUrl: URL;
		try {
			currentUrl = new URL(url);
		} catch {
			throw new Error('malformed url');
		}

		let res: Response;
		let redirects = 0;
		// `redirect: 'manual'` so every hop -- not just the first URL -- gets checked against
		// `isSafeMediaUrl` before it's actually connected to.
		for (;;) {
			if (!isSafeMediaUrl(currentUrl)) {
				throw new Error(`refusing to fetch a non-public url: ${currentUrl.toString()}`);
			}

			res = await fetch(currentUrl, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

			if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
				if (redirects >= MAX_REDIRECTS) {
					throw new Error('too many redirects');
				}

				redirects++;
				currentUrl = new URL(res.headers.get('location')!, currentUrl);
				continue;
			}

			break;
		}

		if (!res.ok) {
			throw new Error(`unexpected status ${res.status}`);
		}

		// Cheap pre-check against the declared length before reading anything -- doesn't replace the
		// streamed cap below (a server can lie about or omit `content-length`), just avoids starting a
		// pointless download when it's honest about being oversized.
		const declaredLength = Number(res.headers.get('content-length'));
		if (Number.isFinite(declaredLength) && declaredLength > MAX_REUPLOAD_BYTES) {
			throw new Error('declared content-length exceeds the reupload limit');
		}

		if (!res.body) {
			throw new Error('response has no body');
		}

		// Read incrementally with a hard cap instead of `res.arrayBuffer()` -- that buffers the *entire*
		// response before any size check runs, so an oversized or infinitely-streaming response (whether
		// malicious or just a server that lied about/omitted `content-length`) would otherwise be read
		// into memory in full before being rejected.
		const chunks: Uint8Array[] = [];
		let total = 0;
		const reader = res.body.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				total += value.byteLength;
				if (total > MAX_REUPLOAD_BYTES) {
					throw new Error('response body exceeds the reupload limit');
				}

				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}

		// Real Discord attachments/stickers always pass a `contentType` in already -- this fallback only
		// matters for a snippet's staff-pasted URL, which has no Discord-verified metadata up front.
		const resolvedContentType = contentType ?? res.headers.get('content-type') ?? undefined;

		const data = Buffer.concat(chunks);
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
		// on this check instead (mirrors the sticker loop's post-fetch total check below).
		if (fetchResult.size > MAX_REUPLOAD_BYTES || totalBytes + fetchResult.size > MAX_TOTAL_REUPLOAD_BYTES) {
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
