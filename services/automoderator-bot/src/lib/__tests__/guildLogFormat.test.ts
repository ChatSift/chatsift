import { expect, test } from 'vitest';
import {
	buildFilterHitEmbed,
	buildMessageDeleteEmbed,
	buildMessageEditEmbed,
	buildProfileChangeEmbed,
} from '../guildLogFormat.js';

// A real snowflake, so the `<t:...:R>` timestamps below are derived rather than asserted against a constant
// somebody would have to recompute if the epoch maths ever changed.
const MESSAGE_ID = '1425493115053019319';
const GUILD_ID = '1425493115053019310';
const CHANNEL_ID = '1425493115053019311';

const AUTHOR = { id: '110000000000000001', tag: 'alice', avatar: 'avatarhash' };
const MODERATOR = { id: '120000000000000001', tag: 'moderator-one', avatar: null };

test('a delete embed names the author, the channel and what the message said', () => {
	const embed = buildMessageDeleteEmbed({
		author: AUTHOR,
		channelId: CHANNEL_ID,
		messageId: MESSAGE_ID,
		content: 'something regrettable',
		attachmentCount: 0,
		moderator: null,
	});

	expect(embed.author?.name).toBe('alice (110000000000000001)');
	expect(embed.author?.icon_url).toBe(
		'https://cdn.discordapp.com/avatars/110000000000000001/avatarhash.png',
	);
	expect(embed.description).toContain(`<#${CHANNEL_ID}>`);
	expect(embed.fields?.[0]).toEqual({ name: 'Content', value: '>>> something regrettable' });
	// No moderator means no footer at all, rather than a footer asserting a self-delete we cannot prove.
	expect(embed.footer).toBeUndefined();
});

test('an attachment-only delete says so instead of rendering an empty field', () => {
	const embed = buildMessageDeleteEmbed({
		author: AUTHOR,
		channelId: CHANNEL_ID,
		messageId: MESSAGE_ID,
		content: '',
		attachmentCount: 2,
		moderator: null,
	});

	// An empty embed field value is a 400 from Discord, which is what makes this branch load-bearing rather
	// than cosmetic.
	expect(embed.fields?.[0]?.value).toBe('*No text content*');
	expect(embed.fields?.[1]?.value).toContain('2 attachments');
});

test('a single attachment is not pluralised', () => {
	const embed = buildMessageDeleteEmbed({
		author: AUTHOR,
		channelId: CHANNEL_ID,
		messageId: MESSAGE_ID,
		content: 'x',
		attachmentCount: 1,
		moderator: null,
	});

	expect(embed.fields?.[1]?.value).toContain('1 attachment,');
});

test('an attributed delete names who did it', () => {
	const embed = buildMessageDeleteEmbed({
		author: AUTHOR,
		channelId: CHANNEL_ID,
		messageId: MESSAGE_ID,
		content: 'x',
		attachmentCount: 0,
		moderator: MODERATOR,
	});

	expect(embed.footer?.text).toBe('Deleted by moderator-one (120000000000000001)');
});

test('over-long content is truncated inside the field limit, quote prefix included', () => {
	const embed = buildMessageDeleteEmbed({
		author: AUTHOR,
		channelId: CHANNEL_ID,
		messageId: MESSAGE_ID,
		content: 'a'.repeat(5_000),
		attachmentCount: 0,
		moderator: null,
	});

	const value = embed.fields![0]!.value;
	expect(value.length).toBeLessThanOrEqual(1_024);
	expect(value.startsWith('>>> ')).toBe(true);
	expect(value.endsWith('…')).toBe(true);
});

test('an edit embed carries both versions and a jump link', () => {
	const embed = buildMessageEditEmbed({
		author: AUTHOR,
		guildId: GUILD_ID,
		channelId: CHANNEL_ID,
		messageId: MESSAGE_ID,
		before: 'first draft',
		after: 'second draft',
	});

	expect(embed.description).toContain(`https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${MESSAGE_ID}`);
	expect(embed.fields?.[0]).toEqual({ name: 'Before', value: '>>> first draft' });
	expect(embed.fields?.[1]).toEqual({ name: 'After', value: '>>> second draft' });
});

test('a cleared nickname reads as none rather than as an empty field', () => {
	const embed = buildProfileChangeEmbed({
		user: AUTHOR,
		kind: 'nickname',
		before: 'Al',
		after: null,
	});

	expect(embed.title).toBe('Changed their nickname');
	expect(embed.fields?.[0]?.value).toBe('Al');
	expect(embed.fields?.[1]?.value).toBe('*none*');
});

test('an avatarless actor gets an author line without an icon', () => {
	const embed = buildProfileChangeEmbed({
		user: MODERATOR,
		kind: 'display name',
		before: null,
		after: 'Mod One',
	});

	expect(embed.author).toMatchObject({ name: 'moderator-one (120000000000000001)' });
	expect(embed.title).toBe('Changed their display name');
});

test('a filter hit names what caught it, what matched and what came of it', () => {
	const embed = buildFilterHitEmbed({
		author: AUTHOR,
		channelId: CHANNEL_ID,
		source: 'Slurs',
		matched: 'badword',
		content: 'a message with badword in it',
		outcome: { summary: 'Banned', caseRef: '[#12](https://discord.com/channels/1/2/99)' },
	});

	expect(embed.description).toBe(`Filter triggered in <#${CHANNEL_ID}>`);
	expect(embed.fields).toEqual([
		{ name: 'Filter', value: 'Slurs', inline: true },
		// The case number is appended rather than being its own field: it is only ever meaningful next to the
		// outcome that produced it.
		{ name: 'Outcome', value: 'Banned (case [#12](https://discord.com/channels/1/2/99))', inline: true },
		{ name: 'Matched', value: '`badword`' },
		{ name: 'Content', value: '>>> a message with badword in it' },
	]);
});

// A hit nobody configured a response to still gets logged -- that is the whole point of feature 33, and the
// embed has to render without a case number or a matched keyword.
test('a filter hit with no policy and no named keyword still renders', () => {
	const embed = buildFilterHitEmbed({
		author: AUTHOR,
		channelId: null,
		source: '1425493115053019311',
		matched: null,
		content: null,
		outcome: { summary: 'No policy configured' },
	});

	expect(embed.description).toBe('Filter triggered');
	expect(embed.fields).toEqual([
		{ name: 'Filter', value: '1425493115053019311', inline: true },
		{ name: 'Outcome', value: 'No policy configured', inline: true },
		// An embed field value cannot be empty, so the missing-content branch has to say something -- without
		// it the whole log post 400s, which is the same trap the message builders have.
		{ name: 'Content', value: '*Not available*' },
	]);
});
