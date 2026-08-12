import { MessageReferenceType } from '@discordjs/core';
import { afterEach, expect, test, vi } from 'vitest';

const { fakeFindRepliedToGuildMessageId } = vi.hoisted(() => ({
	fakeFindRepliedToGuildMessageId: vi.fn(),
}));

// The only runtime import `messageContext.ts` has (everything else it pulls in is type-only) -- and it
// reaches the database, so it's stubbed rather than loaded.
vi.mock('../threads.js', () => ({ findRepliedToGuildMessageId: fakeFindRepliedToGuildMessageId }));

const { buildContextNote, resolveEffectiveContent, resolveReplyNote } = await import('../messageContext.js');

const GUILD = '1530909114736050316';
const MOD_THREAD = '1530909114736050317';
const thread = { guildId: GUILD, id: 1 as never, modThreadId: MOD_THREAD };
const warn = vi.fn();
const logger = { warn } as never;

afterEach(() => {
	vi.clearAllMocks();
});

test('an ordinary message reports its own content', () => {
	expect(
		resolveEffectiveContent({
			attachments: [{ filename: 'a.png', size: 1, url: 'https://cdn.example/a.png' }],
			content: 'hello',
			sticker_items: [{ format_type: 1, id: '1', name: 'wave' }],
		}),
	).toStrictEqual({
		attachments: [{ filename: 'a.png', size: 1, url: 'https://cdn.example/a.png' }],
		content: 'hello',
		isForwarded: false,
		stickers: [{ format_type: 1, id: '1', name: 'wave' }],
	});
});

// Discord's Forward feature posts a near-empty message whose real content lives in `message_snapshots[0]`
// -- reading straight off `message.content` the way a normal relay does drops a forward entirely.
test('a forwarded message reports the snapshot content instead of its own', () => {
	expect(
		resolveEffectiveContent({
			attachments: [],
			content: '',
			message_reference: { type: MessageReferenceType.Forward },
			message_snapshots: [
				{
					message: {
						attachments: [{ filename: 'forwarded.png', size: 2, url: 'https://cdn.example/forwarded.png' }],
						content: 'the real text',
						sticker_items: [{ format_type: 2, id: '9', name: 'dance' }],
					},
				},
			],
		}),
	).toStrictEqual({
		attachments: [{ filename: 'forwarded.png', size: 2, url: 'https://cdn.example/forwarded.png' }],
		content: 'the real text',
		isForwarded: true,
		stickers: [{ format_type: 2, id: '9', name: 'dance' }],
	});
});

// Both halves of the guard matter: a Default-type reference isn't a forward, and a Forward-typed message
// with no snapshot has nothing better to fall back to than its own (empty) content.
test('a forward type with no snapshot falls back to the message itself', () => {
	expect(
		resolveEffectiveContent({
			attachments: [],
			content: 'still mine',
			message_reference: { type: MessageReferenceType.Forward },
		}),
	).toMatchObject({ content: 'still mine', isForwarded: false });

	expect(
		resolveEffectiveContent({
			attachments: [],
			content: 'a reply',
			message_reference: { message_id: '5', type: MessageReferenceType.Default },
			message_snapshots: [{ message: { attachments: [], content: 'ignored' } }],
		}),
	).toMatchObject({ content: 'a reply', isForwarded: false });
});

test('missing sticker_items normalize to an empty array', () => {
	expect(resolveEffectiveContent({ attachments: [], content: 'hi' }).stickers).toStrictEqual([]);
	expect(
		resolveEffectiveContent({
			attachments: [],
			content: '',
			message_reference: { type: MessageReferenceType.Forward },
			message_snapshots: [{ message: { attachments: [], content: 'forwarded' } }],
		}).stickers,
	).toStrictEqual([]);
});

// A poll message carries no `content` at all -- relaying content/attachments/stickers alone dropped it
// silently, so the question and its options are flattened into the content instead.
test('a poll is flattened into the message content', () => {
	expect(
		resolveEffectiveContent({
			attachments: [],
			content: '',
			poll: {
				answers: [{ poll_media: { text: 'Red' } }, { poll_media: { text: 'Blue' } }],
				question: { text: 'Favourite colour?' },
			},
		}).content,
	).toBe('📊 **Poll:** Favourite colour?\n- Red\n- Blue');
});

test('a poll with text alongside it keeps both, separated', () => {
	expect(
		resolveEffectiveContent({
			attachments: [],
			content: 'help me decide',
			poll: { answers: [{ poll_media: { text: 'Yes' } }], question: { text: 'Should I?' } },
		}).content,
	).toBe('help me decide\n\n📊 **Poll:** Should I?\n- Yes');
});

// Every field of `APIPollMedia` is optional in the payload type, so a poll with nothing usable in it must
// still render as *something* -- the point is that mods can tell a poll was sent at all.
test('a poll with no usable text still announces itself', () => {
	expect(
		resolveEffectiveContent({
			attachments: [],
			content: '',
			poll: { answers: [{ poll_media: {} }], question: {} },
		}).content,
	).toBe('📊 **Poll:** *(no question)*');
});

test('a forwarded poll is read off the snapshot, not the empty outer message', () => {
	expect(
		resolveEffectiveContent({
			attachments: [],
			content: '',
			message_reference: { type: MessageReferenceType.Forward },
			message_snapshots: [
				{
					message: {
						attachments: [],
						content: '',
						poll: { answers: [{ poll_media: { text: 'A' } }], question: { text: 'Which?' } },
					},
				},
			],
		}),
	).toMatchObject({ content: '📊 **Poll:** Which?\n- A', isForwarded: true });
});

test('a native reply resolves to a link into the mod thread', async () => {
	fakeFindRepliedToGuildMessageId.mockResolvedValue({ guildMessageId: '777' });

	await expect(
		resolveReplyNote(thread, { attachments: [], content: 'yes', message_reference: { message_id: '5' } }, logger),
	).resolves.toBe(`↩️ *replying to [this message](https://discord.com/channels/${GUILD}/${MOD_THREAD}/777)*`);
});

// The replied-to message may predate recording being enabled, or have been relayed before this thread
// started tracking ids -- the mod still deserves to know it *was* a reply.
test('a reply whose target was never relayed degrades to a generic note', async () => {
	fakeFindRepliedToGuildMessageId.mockResolvedValue(undefined);

	await expect(
		resolveReplyNote(thread, { attachments: [], content: 'yes', message_reference: { message_id: '5' } }, logger),
	).resolves.toBe('↩️ *replying to an earlier message*');
});

// Reply context is decoration -- a database hiccup here must never take the whole relay down with it.
test('a lookup failure degrades to the same generic note and is logged', async () => {
	fakeFindRepliedToGuildMessageId.mockRejectedValue(new Error('db down'));

	await expect(
		resolveReplyNote(thread, { attachments: [], content: 'yes', message_reference: { message_id: '5' } }, logger),
	).resolves.toBe('↩️ *replying to an earlier message*');
	expect(warn).toHaveBeenCalledOnce();
});

test('a non-reply and a forward both short-circuit before any lookup', async () => {
	await expect(resolveReplyNote(thread, { attachments: [], content: 'plain' }, logger)).resolves.toBeUndefined();
	await expect(
		resolveReplyNote(
			thread,
			{ attachments: [], content: '', message_reference: { message_id: '5', type: MessageReferenceType.Forward } },
			logger,
		),
	).resolves.toBeUndefined();

	expect(fakeFindRepliedToGuildMessageId).not.toHaveBeenCalled();
});

test('a forward gets its own note and never looks up reply context', async () => {
	await expect(buildContextNote({ attachments: [], content: '' }, true, thread, logger)).resolves.toBe(
		'📨 *Forwarded message*',
	);
	expect(fakeFindRepliedToGuildMessageId).not.toHaveBeenCalled();
});

test('a plain message gets no context note at all', async () => {
	await expect(buildContextNote({ attachments: [], content: 'hi' }, false, thread, logger)).resolves.toBeUndefined();
});
