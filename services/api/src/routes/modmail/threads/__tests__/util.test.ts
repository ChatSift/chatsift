import type { CategoriesId } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { fakeGetMessage } = vi.hoisted(() => ({ fakeGetMessage: vi.fn() }));

// `util.ts` transitively imports `@chatsift/backend-core`, which parses `process.env` at module-load time.
vi.mock('@chatsift/backend-core', async (importActual) => {
	const { stubTestEnv } = await import('../../../../__tests__/stubEnv.js');
	stubTestEnv();

	return importActual();
});

// The Discord REST clients are constructed at module scope off the context's bot tokens.
vi.mock('../../../../util/discordAPI.js', () => ({
	apiForGuild: () => ({ channels: { getMessage: fakeGetMessage } }),
}));
vi.mock('../../../../util/users.js', () => ({ resolveDiscordUser: vi.fn() }));

const { resolveMessageAttachments, toThreadCategory } = await import('../util.js');

const GUILD = '1530909114736050316';
const MOD_THREAD = '1530909114736050317';
const MESSAGE = '1530909114736050318';

const NOW = Date.parse('2026-08-11T12:00:00.000Z');
// Discord signs attachment urls with an `ex` query param: a hex unix-seconds expiry.
const hexSeconds = (ms: number) => Math.floor(ms / 1_000).toString(16);

function recorded(
	overrides: Partial<{ contentType: string | null; filename: string; size: number; url: string }> = {},
) {
	return {
		contentType: 'image/png',
		filename: 'screenshot.png',
		size: 100,
		url: `https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=${hexSeconds(NOW + 60_000)}`,
		...overrides,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

// kanel brands every table's id type, and `@chatsift/db` only re-exports the type -- one cast at the
// boundary rather than at each call site, mirroring `routes/ama/questions/__tests__/util.test.ts`.
const categoryId = 3 as CategoriesId;

test('toThreadCategory narrows a category row and passes null through', () => {
	expect(toThreadCategory({ emoji: '👋', id: categoryId, name: 'Support' })).toStrictEqual({
		emoji: '👋',
		id: 3,
		name: 'Support',
	});
	expect(toThreadCategory({ emoji: null, id: categoryId, name: 'Support' })).toStrictEqual({
		emoji: null,
		id: 3,
		name: 'Support',
	});
	expect(toThreadCategory(null)).toBeNull();
});

test('a message with no attachments never refetches', async () => {
	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [])).resolves.toStrictEqual([]);
	expect(fakeGetMessage).not.toHaveBeenCalled();
});

test('unexpired attachments are returned as-is, available', async () => {
	const attachment = recorded();

	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [attachment])).resolves.toStrictEqual([
		{ ...attachment, available: true },
	]);
	expect(fakeGetMessage).not.toHaveBeenCalled();
});

// Only refetch on a url shape actually recognizable as stale, never speculatively -- a url with no `ex`
// param (or one that isn't a url at all) says nothing about expiry.
test('an unrecognizable url is treated as not expired', async () => {
	const noEx = recorded({ url: 'https://cdn.discordapp.com/attachments/1/2/screenshot.png' });
	const notAUrl = recorded({ filename: 'other.png', url: 'not a url' });

	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [noEx, notAUrl])).resolves.toStrictEqual([
		{ ...noEx, available: true },
		{ ...notAUrl, available: true },
	]);
	expect(fakeGetMessage).not.toHaveBeenCalled();
});

// `Number.parseInt('12g34', 16)` happily yields 18 off the leading valid-hex prefix, which would read as a
// 1970 expiry and trigger a pointless refetch on every single read -- the full-string hex check prevents that.
test('a malformed ex param is not misread as an ancient expiry', async () => {
	const malformed = recorded({ url: 'https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=12g34' });

	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [malformed])).resolves.toStrictEqual([
		{ ...malformed, available: true },
	]);
	expect(fakeGetMessage).not.toHaveBeenCalled();
});

// The mod-forum message these were re-uploaded onto is never deleted, so an expiry can always be healed by
// re-reading that message and matching by filename (stable across refetches, unlike the url itself).
test('an expired url is healed from the source message, matched by filename', async () => {
	const expired = recorded({ url: `https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=${hexSeconds(NOW)}` });
	fakeGetMessage.mockResolvedValue({
		attachments: [
			{ filename: 'screenshot.png', size: 250, content_type: 'image/webp', url: 'https://cdn.example/fresh.webp' },
		],
		embeds: [],
	});

	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [expired])).resolves.toStrictEqual([
		{
			available: true,
			contentType: 'image/webp',
			filename: 'screenshot.png',
			size: 250,
			url: 'https://cdn.example/fresh.webp',
		},
	]);
	expect(fakeGetMessage).toHaveBeenCalledWith(MOD_THREAD, MESSAGE);
});

// One expired attachment is enough to justify the single refetch, and every attachment on the message gets
// refreshed off it -- there's no per-attachment fetch to make.
test('one expired attachment refreshes the whole set in a single call', async () => {
	const fresh = recorded({ filename: 'fresh.png' });
	const expired = recorded({
		filename: 'stale.png',
		url: `https://cdn.discordapp.com/attachments/1/2/stale.png?ex=${hexSeconds(NOW - 1_000)}`,
	});
	fakeGetMessage.mockResolvedValue({
		attachments: [
			{ filename: 'fresh.png', size: 1, content_type: 'image/png', url: 'https://cdn.example/fresh.png' },
			{ filename: 'stale.png', size: 2, content_type: 'image/png', url: 'https://cdn.example/stale.png' },
		],
		embeds: [],
	});

	const result = await resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [fresh, expired]);

	expect(result.map((attachment) => attachment.url)).toStrictEqual([
		'https://cdn.example/fresh.png',
		'https://cdn.example/stale.png',
	]);
	expect(fakeGetMessage).toHaveBeenCalledOnce();
});

// The frontend renders this as "no longer exists on Discord" rather than trying (and failing) to load the url.
test('an attachment missing from the refetched message is marked unavailable', async () => {
	const expired = recorded({ url: `https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=${hexSeconds(NOW)}` });
	fakeGetMessage.mockResolvedValue({ attachments: [], embeds: [] });

	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [expired])).resolves.toStrictEqual([
		{ ...expired, available: false },
	]);
});

// #371: a lone relayed image is claimed into the embed's `image` slot, and Discord then reports an empty
// top-level `attachments` array for it -- so filename-matching against `attachments` alone healed nothing
// and silently struck out an attachment that was still sitting in the mod thread.
test('an embed-claimed image is healed off the embed, not the empty attachment list', async () => {
	const expired = recorded({ url: `https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=${hexSeconds(NOW)}` });
	fakeGetMessage.mockResolvedValue({
		attachments: [],
		embeds: [
			{
				image: { url: 'https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=deadbeef&is=1&hm=2' },
			},
		],
	});

	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [expired])).resolves.toStrictEqual([
		{
			available: true,
			// Neither size nor content type is on an embed image, so the recorded ones stand.
			contentType: 'image/png',
			filename: 'screenshot.png',
			size: 100,
			url: 'https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=deadbeef&is=1&hm=2',
		},
	]);
});

// Discord percent-encodes the filename in the url, so the match has to happen on the decoded form.
test('an embed-claimed image with a percent-encoded filename still matches', async () => {
	const expired = recorded({
		filename: 'my screen shot.png',
		url: `https://cdn.discordapp.com/attachments/1/2/my%20screen%20shot.png?ex=${hexSeconds(NOW)}`,
	});
	const fresh = 'https://cdn.discordapp.com/attachments/1/2/my%20screen%20shot.png?ex=deadbeef';
	fakeGetMessage.mockResolvedValue({ attachments: [], embeds: [{ image: { url: fresh } }] });

	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [expired])).resolves.toMatchObject([
		{ available: true, url: fresh },
	]);
});

// A snippet's fixed image (or any other external one) isn't a recorded attachment at all -- it must never
// be mistaken for one and used to mark a genuinely-gone file as available.
test('a non-attachment embed image is ignored', async () => {
	const expired = recorded({ url: `https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=${hexSeconds(NOW)}` });
	fakeGetMessage.mockResolvedValue({
		attachments: [],
		embeds: [{ image: { url: 'https://example.com/screenshot.png' } }],
	});

	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [expired])).resolves.toStrictEqual([
		{ ...expired, available: false },
	]);
});

// The top-level attachment list is the better source when it does carry the file -- it refreshes size and
// content type too, which an embed image can't.
test('a real attachment entry wins over an embed image of the same name', async () => {
	const expired = recorded({ url: `https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=${hexSeconds(NOW)}` });
	fakeGetMessage.mockResolvedValue({
		attachments: [
			{ filename: 'screenshot.png', size: 250, content_type: 'image/webp', url: 'https://cdn.example/fresh.webp' },
		],
		embeds: [{ image: { url: 'https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=deadbeef' } }],
	});

	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [expired])).resolves.toStrictEqual([
		{
			available: true,
			contentType: 'image/webp',
			filename: 'screenshot.png',
			size: 250,
			url: 'https://cdn.example/fresh.webp',
		},
	]);
});

// The durable record being gone isn't expected, but it must degrade rather than fail the whole GET.
test('a 404 on the source message marks everything unavailable instead of throwing', async () => {
	const expired = recorded({ url: `https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=${hexSeconds(NOW)}` });
	fakeGetMessage.mockRejectedValue(
		new DiscordAPIError({ code: 10_008, message: 'Unknown Message' }, 10_008, 404, 'GET', '', {}),
	);

	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [expired])).resolves.toStrictEqual([
		{ ...expired, available: false },
	]);
});

// A rate limit or 5xx says nothing about whether the message still exists, so it must not be reported as
// "attachment gone" -- it propagates.
test('any other Discord failure propagates', async () => {
	const expired = recorded({ url: `https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=${hexSeconds(NOW)}` });
	fakeGetMessage.mockRejectedValue(new DiscordAPIError({ code: 0, message: 'boom' }, 0, 500, 'GET', '', {}));

	await expect(resolveMessageAttachments(GUILD, MOD_THREAD, MESSAGE, [expired])).rejects.toBeInstanceOf(
		DiscordAPIError,
	);
});
