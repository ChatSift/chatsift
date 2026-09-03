import type { APIMessage } from '@discordjs/core';
import { expect, test, vi } from 'vitest';

vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({ service: { client: { api: {} } } }),
	publishRealtimeInvalidate: async () => undefined,
	// The report card resolves the target's avatar through `bot-core`, whose barrel builds a `RedisStore`
	// subclass at module scope.
	RedisStore: class {},
}));

const { firstImageUrl, shouldReopenReport, snapshotMessage } = await import('../reportFlow.js');

type ImageSource = Pick<APIMessage, 'attachments' | 'embeds'>;

function message(overrides: Partial<ImageSource> = {}): ImageSource {
	return { attachments: [], embeds: [], ...overrides };
}

test('a real attachment wins', () => {
	const source = message({
		attachments: [{ url: 'https://cdn.discordapp.com/a.png', content_type: 'image/png' }] as ImageSource['attachments'],
		embeds: [{ image: { url: 'https://example.com/embed.png' } }],
	});

	expect(firstImageUrl(source)).toBe('https://cdn.discordapp.com/a.png');
});

test('an attachment Discord did not type is not assumed to be an image', () => {
	// Guessing "image" for an untyped attachment puts a non-image url into the embed's `image`, which Discord then
	// fails to render. Falling through to the embeds is the better answer.
	const untyped = message({
		attachments: [{ url: 'https://cdn.discordapp.com/mystery.bin' }] as ImageSource['attachments'],
	});
	expect(firstImageUrl(untyped)).toBeNull();

	const withFallback = message({
		attachments: [{ url: 'https://cdn.discordapp.com/mystery.bin' }] as ImageSource['attachments'],
		embeds: [{ image: { url: 'https://example.com/embed.png' } }],
	});
	expect(firstImageUrl(withFallback)).toBe('https://example.com/embed.png');
});

test('a non-image attachment is skipped in favour of a later image one', () => {
	const source = message({
		attachments: [
			{ url: 'https://cdn.discordapp.com/clip.mp4', content_type: 'video/mp4' },
			{ url: 'https://cdn.discordapp.com/shot.png', content_type: 'image/png' },
		] as ImageSource['attachments'],
	});

	expect(firstImageUrl(source)).toBe('https://cdn.discordapp.com/shot.png');
});

test('an embed image is used when the attachment array is empty', () => {
	// The behaviour this exists for: a message whose single image Discord has claimed into an embed comes back
	// with an **empty** top-level `attachments` array, so reading only `attachments[0]` silently drops the image
	// from exactly the kind of message people report.
	const source = message({ embeds: [{ image: { url: 'https://example.com/claimed.png' } }] });

	expect(firstImageUrl(source)).toBe('https://example.com/claimed.png');
});

test('a thumbnail counts, and the first embed carrying either one wins', () => {
	expect(firstImageUrl(message({ embeds: [{ thumbnail: { url: 'https://example.com/thumb.png' } }] }))).toBe(
		'https://example.com/thumb.png',
	);

	expect(
		firstImageUrl(
			message({
				embeds: [{ description: 'no image here' }, { image: { url: 'https://example.com/second.png' } }],
			}),
		),
	).toBe('https://example.com/second.png');
});

test('a message with nothing visual resolves to null', () => {
	expect(firstImageUrl(message())).toBeNull();
	expect(firstImageUrl(message({ embeds: [{ title: 'a link preview with no media' }] }))).toBeNull();
});

test('the snapshot keeps empty content as null rather than an empty string', () => {
	// `null` and `''` render differently on the card ("no text content" versus an empty code block), and the
	// column is nullable precisely so the distinction survives.
	const base = { id: '3', channel_id: '4', attachments: [], embeds: [] } as unknown as APIMessage;

	expect(snapshotMessage({ ...base, content: '' }).content).toBeNull();
	expect(snapshotMessage({ ...base, content: 'rude' }).content).toBe('rude');
	expect(snapshotMessage({ ...base, content: 'rude' })).toMatchObject({ messageId: '3', channelId: '4' });
});

// The rule that keeps a report from being actioned twice. A ladder rung failing leaves the warn filed and
// logged, so reopening the report would let the next moderator turn it into a second warn -- and push the
// target up another rung. Every other failure really did leave them unpunished.
test('only a ladder failure keeps the report terminal', async () => {
	const { LadderFailureError, CaseFilingError, SoftbanUnbanError } = await import('../moderation.js');
	const warnCase = { caseId: 7 } as never;

	expect(shouldReopenReport(new LadderFailureError(warnCase, 3, new Error('no permission')))).toBe(false);

	expect(shouldReopenReport(new CaseFilingError(false, new Error('db down')))).toBe(true);
	expect(shouldReopenReport(new SoftbanUnbanError(new Error('nope')))).toBe(true);
	expect(shouldReopenReport(new Error('anything else'))).toBe(true);
});
