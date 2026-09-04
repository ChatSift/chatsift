import { expect, test } from 'vitest';
import type { PurgeableMessage } from '../purge.js';
import {
	chunkForBulkDelete,
	isPastPurgeRange,
	matchesPurgeCriteria,
	PURGE_MAX_AGE_MS,
	selectPurgeTargets,
} from '../purge.js';

const DISCORD_EPOCH_MS = 1_420_070_400_000;
const NOW = 1_800_000_000_000;

/**
 * A snowflake for a message posted `agoMs` before {@link NOW}, so a test can say "eight days old" instead of
 * carrying a magic id.
 */
function idAt(agoMs: number, increment = 0): string {
	return String((BigInt(NOW - agoMs - DISCORD_EPOCH_MS) << 22n) + BigInt(increment));
}

function message(overrides: Partial<PurgeableMessage> = {}): PurgeableMessage {
	return {
		id: idAt(1_000),
		content: '',
		author: { id: '100' },
		attachments: [],
		embeds: [],
		...overrides,
	};
}

test('a message older than two weeks is never selected, whatever else matches', () => {
	const old = message({ id: idAt(PURGE_MAX_AGE_MS + 1_000), author: { id: '100' } });
	expect(matchesPurgeCriteria(old, { authorId: '100' }, NOW)).toBe(false);
});

test('every criterion narrows -- a message has to satisfy all of them', () => {
	const target = message({ content: 'buy followers', author: { id: '100', bot: true } });

	expect(matchesPurgeCriteria(target, { authorId: '100', botsOnly: true, includes: 'followers' }, NOW)).toBe(true);
	// Same message, one criterion it fails.
	expect(matchesPurgeCriteria(target, { authorId: '999', botsOnly: true, includes: 'followers' }, NOW)).toBe(false);
});

test('webhook posts count as bots', () => {
	const webhook = message({ author: { id: '100' }, webhook_id: '55' });
	expect(matchesPurgeCriteria(webhook, { botsOnly: true }, NOW)).toBe(true);
	expect(matchesPurgeCriteria(message(), { botsOnly: true }, NOW)).toBe(false);
});

// Legacy matched case-sensitively, so cleaning up "FREE NITRO" needed the filter typed in the same shout.
test('includes ignores case', () => {
	expect(matchesPurgeCriteria(message({ content: 'FREE NITRO' }), { includes: 'free nitro' }, NOW)).toBe(true);
});

// The bug this replaces: attachment URLs are signed now, so `url.endsWith('.png')` had stopped matching
// anything at all.
test('media matches on the attachment filename, not the signed url', () => {
	const image = message({
		attachments: [{ filename: 'cat.PNG', content_type: 'image/png' }],
	});

	expect(matchesPurgeCriteria(image, { media: 'images' }, NOW)).toBe(true);
	expect(matchesPurgeCriteria(image, { media: 'videos' }, NOW)).toBe(false);
});

test('media also matches a link typed into the message', () => {
	const linked = message({ content: 'look https://example.com/clip.mp4 at this' });
	expect(matchesPurgeCriteria(linked, { media: 'videos' }, NOW)).toBe(true);
	expect(matchesPurgeCriteria(linked, { media: 'gifs' }, NOW)).toBe(false);
});

test('embeds and all are different filters', () => {
	const embedOnly = message({ embeds: [{}] });
	expect(matchesPurgeCriteria(embedOnly, { media: 'embeds' }, NOW)).toBe(true);
	expect(matchesPurgeCriteria(embedOnly, { media: 'all' }, NOW)).toBe(true);
	expect(matchesPurgeCriteria(embedOnly, { media: 'images' }, NOW)).toBe(false);

	const gif = message({ attachments: [{ filename: 'dance.gif' }] });
	expect(matchesPurgeCriteria(gif, { media: 'all' }, NOW)).toBe(true);
	expect(matchesPurgeCriteria(gif, { media: 'embeds' }, NOW)).toBe(false);
});

// The bounds are exclusive on both ends: the two messages a moderator names are the fenceposts, not part of
// what gets deleted.
test('start and end exclude the messages they name', () => {
	const start = idAt(5_000);
	const end = idAt(1_000);

	expect(matchesPurgeCriteria(message({ id: start }), { newerThanId: start, olderThanId: end }, NOW)).toBe(false);
	expect(matchesPurgeCriteria(message({ id: end }), { newerThanId: start, olderThanId: end }, NOW)).toBe(false);
	expect(matchesPurgeCriteria(message({ id: idAt(3_000) }), { newerThanId: start, olderThanId: end }, NOW)).toBe(true);
});

test('two messages posted in the same millisecond are still ordered', () => {
	const start = idAt(2_000, 1);
	// Same timestamp, higher sequence -- posted after `start`, and a timestamp comparison would call it a tie.
	expect(matchesPurgeCriteria(message({ id: idAt(2_000, 2) }), { newerThanId: start }, NOW)).toBe(true);
});

test('selection stops at the amount asked for, newest first', () => {
	const messages = [message({ id: idAt(1_000) }), message({ id: idAt(2_000) }), message({ id: idAt(3_000) })];

	expect(selectPurgeTargets(messages, {}, 2, NOW)).toStrictEqual([idAt(1_000), idAt(2_000)]);
});

test('a page whose oldest message is out of range stops the scan', () => {
	expect(isPastPurgeRange(message({ id: idAt(PURGE_MAX_AGE_MS + 1) }), {}, NOW)).toBe(true);
	expect(isPastPurgeRange(message({ id: idAt(2_000) }), { newerThanId: idAt(1_000) }, NOW)).toBe(true);
	expect(isPastPurgeRange(message({ id: idAt(2_000) }), { newerThanId: idAt(3_000) }, NOW)).toBe(false);
});

test('batches are capped at a hundred', () => {
	const ids = Array.from({ length: 250 }, (_, index) => String(index));
	expect(chunkForBulkDelete(ids).map((chunk) => chunk.length)).toStrictEqual([100, 100, 50]);
	expect(chunkForBulkDelete([])).toStrictEqual([]);
});
