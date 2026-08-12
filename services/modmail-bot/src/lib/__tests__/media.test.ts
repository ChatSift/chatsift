import { Buffer } from 'node:buffer';
import { StickerFormatType } from '@discordjs/core';
import { afterEach, expect, test, vi } from 'vitest';
import type { RelayAttachmentLike, RelayStickerLike } from '../media.js';
import { buildRelayMedia } from '../media.js';

// `media.ts` has no runtime imports beyond `node:buffer` and `@discordjs/core` constants -- the only
// boundary to stub is `fetch`, which is what makes this branch-dense function unit-testable at all.

const MiB = 1_024 * 1_024;
const warn = vi.fn();
const logger = { warn } as never;

function attachment(overrides: Partial<RelayAttachmentLike> = {}): RelayAttachmentLike {
	return { content_type: 'image/png', filename: 'a.png', size: 10, url: 'https://cdn.example/a.png', ...overrides };
}

function sticker(overrides: Partial<RelayStickerLike> = {}): RelayStickerLike {
	return { format_type: StickerFormatType.PNG, id: '1', name: 'wave', ...overrides };
}

/**
 * Every fetch resolves to `bytes` bytes of payload, so a test can drive the *actual downloaded* size
 * independently of the `size` an attachment claims -- the cumulative budget is checked against the real one.
 */
function stubFetch(bytes = 10) {
	const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(bytes) });
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

test('an ordinary attachment is re-uploaded rather than linked', async () => {
	stubFetch();

	const media = await buildRelayMedia([attachment()], [], logger);

	expect(media.files).toHaveLength(1);
	expect(media.files[0]).toMatchObject({ name: 'a.png', contentType: 'image/png' });
	expect(media.note).toBeUndefined();
});

test('an attachment with no content type is still uploaded, just untyped', async () => {
	stubFetch();

	const media = await buildRelayMedia([attachment({ content_type: undefined })], [], logger);

	expect(media.files[0]).toStrictEqual({ data: expect.any(Buffer), name: 'a.png' });
	// Not an image as far as this can tell, so it doesn't get claimed into the embed.
	expect(media.embedImageRef).toBeUndefined();
});

// The destination channel's real limit depends on boost tier and isn't worth an API call, so this uses
// Discord's conservative non-boosted default instead of risking a failed relay over one oversized file.
test('an oversized attachment is linked instead of re-uploaded', async () => {
	const fetchMock = stubFetch();

	const media = await buildRelayMedia([attachment({ size: 11 * MiB })], [], logger);

	expect(fetchMock).not.toHaveBeenCalled();
	expect(media.files).toHaveLength(0);
	expect(media.note).toBe("*(couldn't forward 1 item(s), original link(s): https://cdn.example/a.png)*");
});

// Discord enforces the limit against the *combined* size of every file on one message, so several
// individually-legal attachments can still add up to a request it rejects outright.
test('the size budget is cumulative, not per-file', async () => {
	stubFetch(6 * MiB);

	const media = await buildRelayMedia(
		[
			attachment({ filename: 'first.png', size: 6 * MiB, url: 'https://cdn.example/first.png' }),
			attachment({ filename: 'second.png', size: 6 * MiB, url: 'https://cdn.example/second.png' }),
		],
		[],
		logger,
	);

	expect(media.files.map((file) => file.name)).toStrictEqual(['first.png']);
	expect(media.note).toContain('https://cdn.example/second.png');
});

test('a failed download falls back to a link and is logged', async () => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

	const media = await buildRelayMedia([attachment()], [], logger);

	expect(media.files).toHaveLength(0);
	expect(media.note).toContain('https://cdn.example/a.png');
	expect(warn).toHaveBeenCalledOnce();
});

test('a thrown fetch is handled the same way as a bad status', async () => {
	vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')));

	const media = await buildRelayMedia([attachment()], [], logger);

	expect(media.files).toHaveLength(0);
	expect(media.note).toContain('https://cdn.example/a.png');
});

// Lottie is vector -- there's no raster the CDN can hand back at all, so it's skipped rather than failed.
test('a Lottie sticker is skipped with its own note and no fetch', async () => {
	const fetchMock = stubFetch();

	const media = await buildRelayMedia([], [sticker({ format_type: StickerFormatType.Lottie })], logger);

	expect(fetchMock).not.toHaveBeenCalled();
	expect(media.files).toHaveLength(0);
	expect(media.note).toBe('*(sent a sticker: "wave" (animated vector, can\'t be forwarded))*');
});

// Discord's own APNG bytes are animated, but a regular attachment slot doesn't get the special animated
// rendering an actual sticker slot has -- called out rather than silently swallowed.
test('an APNG sticker uploads but warns that it will look static', async () => {
	const fetchMock = stubFetch();

	const media = await buildRelayMedia([], [sticker({ format_type: StickerFormatType.APNG })], logger);

	expect(fetchMock.mock.calls[0]![0]).toContain('/stickers/1.png');
	expect(media.files[0]!.name).toBe('wave.png');
	expect(media.note).toBe('*(sent a sticker: "wave" (animated, shown static here))*');
});

test('a GIF sticker takes the gif CDN route and stays animated', async () => {
	const fetchMock = stubFetch();

	const media = await buildRelayMedia([], [sticker({ format_type: StickerFormatType.GIF })], logger);

	expect(fetchMock.mock.calls[0]![0]).toContain('/stickers/1.gif');
	expect(media.files[0]).toMatchObject({ name: 'wave.gif', contentType: 'image/gif' });
	expect(media.note).toBe('*(sent a sticker: "wave")*');
});

// A re-uploaded sticker is just another image attachment once it lands, so the note is what tells mods it
// was a sticker at all -- it has to be there even in the plain, everything-worked case.
test('a successfully forwarded sticker is still called out as a sticker', async () => {
	stubFetch();

	const media = await buildRelayMedia([], [sticker()], logger);

	expect(media.files[0]!.name).toBe('wave.png');
	expect(media.note).toBe('*(sent a sticker: "wave")*');
});

test('a sticker that could not be downloaded is named as a sticker and linked', async () => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

	const media = await buildRelayMedia([], [sticker()], logger);

	expect(media.files).toHaveLength(0);
	expect(media.note!.split('\n')).toStrictEqual([
		'*(sent a sticker: "wave")*',
		"*(couldn't forward 1 item(s), original link(s): https://cdn.discordapp.com/stickers/1.png)*",
	]);
});

// Discord "claims" whichever file an embed's `image` references out of the message's attachment list,
// leaving the rest to render as a separate floating group -- with 2+ files that reads as two disconnected
// chunks of media, so the embed slot is only used when there's exactly one file to put in it.
test('the embed image slot is only claimed for a lone image', async () => {
	stubFetch();

	const single = await buildRelayMedia([attachment()], [], logger);
	expect(single.embedImageRef).toBe('attachment://a.png');

	const pair = await buildRelayMedia([attachment(), attachment({ filename: 'b.png' })], [], logger);
	expect(pair.embedImageRef).toBeUndefined();
	expect(pair.files).toHaveLength(2);
});

test('a lone non-image file is never claimed into the embed', async () => {
	stubFetch();

	const media = await buildRelayMedia(
		[attachment({ content_type: 'application/pdf', filename: 'report.pdf' })],
		[],
		logger,
	);

	expect(media.files).toHaveLength(1);
	expect(media.embedImageRef).toBeUndefined();
});

// Keeps the note bounded: an embed description has a hard 4,096 character cap shared with the message
// content, which a ticket full of oversized attachments could otherwise blow past on its own.
test('the failed-links list caps at five with a "+N more" suffix', async () => {
	stubFetch();
	const oversized = Array.from({ length: 7 }, (_, index) =>
		attachment({ filename: `${index}.png`, size: 11 * MiB, url: `https://cdn.example/${index}.png` }),
	);

	const media = await buildRelayMedia(oversized, [], logger);

	expect(media.note).toContain("couldn't forward 7 item(s)");
	expect(media.note).toContain('(+2 more)');
	expect(media.note).not.toContain('https://cdn.example/5.png');
});

test('multiple notes are each italicized and joined by newlines', async () => {
	stubFetch();

	const media = await buildRelayMedia(
		[attachment({ size: 11 * MiB })],
		[sticker({ format_type: StickerFormatType.Lottie })],
		logger,
	);

	expect(media.note!.split('\n')).toStrictEqual([
		'*(sent a sticker: "wave" (animated vector, can\'t be forwarded))*',
		"*(couldn't forward 1 item(s), original link(s): https://cdn.example/a.png)*",
	]);
});

test('nothing to relay produces an empty result rather than an empty note', async () => {
	stubFetch();

	await expect(buildRelayMedia([], [], logger)).resolves.toStrictEqual({
		embedImageRef: undefined,
		files: [],
		note: undefined,
	});
});
