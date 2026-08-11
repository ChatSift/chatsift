import { Buffer } from 'node:buffer';
import { RouteBases } from '@discordjs/core';
import { expect, test, vi } from 'vitest';

// `emojis.ts` constructs a `RedisStore` at module scope. Nothing under test here goes near it (every
// exported function below is pure), so a bare constructible stub is enough to make the import work --
// same approach `instance.test.ts` takes rather than satisfying the real module's env schema.
vi.mock('@chatsift/backend-core', () => ({
	RedisStore: class {},
}));

const { buildForeignEmojiRejection, emojiCdnUrl, findForeignEmojiTokens, resolveContentForRelay } =
	await import('../emojis.js');

const OWN = '1425493115053019319';
const FOREIGN = '1425493115053019320';
const guildEmojis = new Set([OWN]);

test('an animated emote uses the webp route with ?animated=true', () => {
	// Deliberately webp rather than gif (#234): some animated emotes are natively webp-sourced and
	// Discord's CDN 404s a `.gif` request for those, while `.webp` always resolves.
	expect(emojiCdnUrl(OWN, true)).toBe(`${RouteBases.cdn}/emojis/${OWN}.webp?animated=true`);
	expect(emojiCdnUrl(OWN, false)).toBe(`${RouteBases.cdn}/emojis/${OWN}.png`);
});

test("an emote from the ticket's own guild is relayed byte-identical", () => {
	const content = `hello <:wave:${OWN}> there`;

	expect(resolveContentForRelay(content, guildEmojis)).toBe(content);
});

// Discord renders an unresolvable custom emote as dead `:name:` text rather than an image, so a foreign
// one is reduced to a clickable link instead.
test('a foreign emote becomes a name-only link to its CDN image', () => {
	expect(resolveContentForRelay(`look <:wave:${FOREIGN}>`, guildEmojis)).toBe(
		`look [:wave:](${RouteBases.cdn}/emojis/${FOREIGN}.png)`,
	);

	expect(resolveContentForRelay(`look <a:dance:${FOREIGN}>`, guildEmojis)).toBe(
		`look [:dance:](${RouteBases.cdn}/emojis/${FOREIGN}.webp?animated=true)`,
	);
});

test('every occurrence is rewritten and surrounding text is untouched', () => {
	const result = resolveContentForRelay(`a <:one:${FOREIGN}> b <:two:${OWN}> c <:three:${FOREIGN}> d`, guildEmojis);

	expect(result).toBe(
		`a [:one:](${RouteBases.cdn}/emojis/${FOREIGN}.png) b <:two:${OWN}> c [:three:](${RouteBases.cdn}/emojis/${FOREIGN}.png) d`,
	);
});

// The token pattern is a module-level `/g` regex shared by every caller -- a stale `lastIndex` leaking
// between calls would make the second relay of an identical message silently differ from the first.
test('the shared global regex has no state leaking between calls', () => {
	const content = `<:aa:${FOREIGN}> <:bb:${FOREIGN}>`;

	expect(resolveContentForRelay(content, guildEmojis)).toBe(resolveContentForRelay(content, guildEmojis));
	expect(findForeignEmojiTokens(content, guildEmojis)).toHaveLength(2);
	expect(findForeignEmojiTokens(content, guildEmojis)).toHaveLength(2);
});

test('plain text with no emote tokens passes straight through', () => {
	expect(resolveContentForRelay('no emotes here :wave:', guildEmojis)).toBe('no emotes here :wave:');
	expect(findForeignEmojiTokens('no emotes here :wave:', guildEmojis)).toStrictEqual([]);
});

// The pattern's `\w{2,32}` name and `\d{17,20}` id bounds mirror what Discord itself accepts, so text that
// merely *looks* emote-shaped isn't mistaken for one and mangled on relay.
test('almost-but-not-quite emote shapes are not treated as tokens', () => {
	const tooShortName = `<:a:${FOREIGN}>`;
	const tooShortId = '<:wave:123>';

	expect(resolveContentForRelay(tooShortName, guildEmojis)).toBe(tooShortName);
	expect(resolveContentForRelay(tooShortId, guildEmojis)).toBe(tooShortId);
	expect(findForeignEmojiTokens(`${tooShortName} ${tooShortId}`, guildEmojis)).toStrictEqual([]);
});

test('findForeignEmojiTokens returns only the out-of-guild ones, parsed', () => {
	expect(findForeignEmojiTokens(`<:mine:${OWN}> <a:theirs:${FOREIGN}>`, guildEmojis)).toStrictEqual([
		{ animated: true, id: FOREIGN, name: 'theirs' },
	]);
});

function tokens(...names: string[]) {
	return names.map((name, index) => ({ animated: false, id: `${index}`, name }));
}

test('the rejection wording is singular for one emote and plural for several', () => {
	const one = buildForeignEmojiRejection(tokens('wave'), 'hi');
	expect(one.content).toContain('includes an emote not from this server (:wave:)');
	expect(one.content).toContain('Fix it and run the command again');

	const many = buildForeignEmojiRejection(tokens('wave', 'dance'), 'hi');
	expect(many.content).toContain('includes an emotes not from this server (:wave:, :dance:)');
	expect(many.content).toContain('Fix them and run the command again');
});

// The same emote used twice is one thing for the mod to go fix, not two.
test('repeated emote names are listed once', () => {
	const rejection = buildForeignEmojiRejection(
		[
			{ animated: false, id: '1', name: 'wave' },
			{ animated: false, id: '1', name: 'wave' },
		],
		'hi',
	);

	expect(rejection.content).toContain('(:wave:)');
	expect(rejection.content).toContain('an emote not from this server');
});

// Bounded so a reply referencing many distinct foreign emotes can't push the preamble past the 2,000
// character interaction cap on the strength of its names list alone.
test('the names list caps at five with a "+N more" suffix', () => {
	const rejection = buildForeignEmojiRejection(tokens('a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'), 'hi');

	expect(rejection.content).toContain('(:a1:, :b2:, :c3:, :d4:, :e5: (+2 more))');
	expect(rejection.content).not.toContain(':f6:');
});

// The echoed-back copy has to be faithful, so the fence must always outlast the longest backtick run the
// mod's own text happens to contain -- otherwise their text would break out of the code block.
test('the code fence is always longer than any backtick run in the original', () => {
	expect(buildForeignEmojiRejection(tokens('wave'), 'plain text').content).toContain('\n```\nplain text\n```');
	expect(buildForeignEmojiRejection(tokens('wave'), 'a ``` b').content).toContain('\n````\na ``` b\n````');
	expect(buildForeignEmojiRejection(tokens('wave'), 'a ````` b').content).toContain('\n``````\na ````` b\n``````');
});

// A modal/option can carry up to 4,000 characters but an interaction response's `content` is hard-capped at
// 2,000 (webhook-authored, so Nitro's 4,000 doesn't apply) -- truncating would lose the mod's text, so the
// full copy moves to a file instead.
test('an over-long original falls back to a .txt attachment instead of being truncated', () => {
	const long = 'x'.repeat(3_000);
	const rejection = buildForeignEmojiRejection(tokens('wave'), long);

	expect(rejection.content.length).toBeLessThanOrEqual(2_000);
	expect(rejection.content).not.toContain('```');
	expect(rejection.files).toHaveLength(1);
	expect(rejection.files![0]!.name).toBe('reply.txt');
	expect(rejection.files![0]!.contentType).toBe('text/plain; charset=utf-8');
	expect(Buffer.from(rejection.files![0]!.data as Uint8Array).toString('utf8')).toBe(long);
});

test('a reply that fits is inlined with no attachment at all', () => {
	const rejection = buildForeignEmojiRejection(tokens('wave'), 'short enough');

	expect(rejection.files).toBeUndefined();
	expect(rejection.content).toContain('short enough');
});
