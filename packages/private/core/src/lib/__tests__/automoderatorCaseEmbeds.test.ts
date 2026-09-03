import { expect, test } from 'vitest';
import type { CaseEmbedInput } from '../automoderatorCaseEmbeds.js';
import {
	buildCaseEmbed,
	formatCaseDuration,
	formatCaseNumber,
	formatCaseUserTag,
	logJumpChannelId,
} from '../automoderatorCaseEmbeds.js';

const CREATED_AT = new Date('2026-08-14T12:00:00.000Z');

function makeCase(overrides: Partial<CaseEmbedInput> = {}): CaseEmbedInput {
	return {
		actionType: 'BAN',
		caseId: 42,
		createdAt: CREATED_AT,
		dryRun: false,
		expiresAt: null,
		guildId: '1',
		modId: '3',
		modTag: 'mod',
		pardonedBy: null,
		reason: 'spam',
		refId: null,
		targetId: '2',
		targetTag: 'target',
		...overrides,
	};
}

test('renders the target, action and moderator', () => {
	const embed = buildCaseEmbed(makeCase());

	expect(embed.author?.name).toBe('target (2)');
	expect(embed.title).toBe('Was banned for spam');
	expect(embed.footer?.text).toBe('Case 42 | By mod (3)');
});

test('omits the reason clause and the moderator when neither is known', () => {
	const embed = buildCaseEmbed(makeCase({ reason: null, modId: null, modTag: null }));

	expect(embed.title).toBe('Was banned');
	expect(embed.footer?.text).toBe('Case 42');
});

test('has no fields at all for a plain case', () => {
	expect(buildCaseEmbed(makeCase()).fields).toBeUndefined();
});

test('deep-links a reference only when the referenced case has a log message and a channel is known', () => {
	const withLink = buildCaseEmbed(makeCase({ refId: 7 }), {
		reference: { logMessageId: '99' },
		logChannelId: '55',
	});
	expect(withLink.fields?.[0]?.value).toBe('[#7](https://discord.com/channels/1/55/99)');

	// The referenced case never made it to the log, so there is nothing to link to.
	const withoutMessage = buildCaseEmbed(makeCase({ refId: 7 }), {
		reference: { logMessageId: null },
		logChannelId: '55',
	});
	expect(withoutMessage.fields?.[0]?.value).toBe('#7');

	// The guild has no mod log configured, so there is no channel to link through.
	const withoutChannel = buildCaseEmbed(makeCase({ refId: 7 }), { reference: { logMessageId: '99' } });
	expect(withoutChannel.fields?.[0]?.value).toBe('#7');
});

test('renders a duration relative to when the case was filed', () => {
	const embed = buildCaseEmbed(
		makeCase({ actionType: 'MUTE', expiresAt: new Date(CREATED_AT.getTime() + 2 * 86_400_000) }),
	);

	expect(embed.fields?.[0]?.name).toBe('Duration');
	expect(embed.fields?.[0]?.value).toContain('2 days');
});

test('says out loud when nothing actually happened', () => {
	const embed = buildCaseEmbed(makeCase({ dryRun: true }));
	expect(embed.fields?.some((field) => field.name === 'Dry run')).toBe(true);
});

test('names who pardoned a case', () => {
	const embed = buildCaseEmbed(makeCase({ actionType: 'WARN', pardonedBy: '9' }));
	expect(embed.fields?.find((field) => field.name === 'Pardoned by')?.value).toBe('<@9>');
});

// A reason can arrive from somewhere that never saw the commands' 400-character cap -- a legacy row at P9, or
// an audit-log reason typed straight into Discord. Over 256 the whole embed is rejected and the case silently
// never reaches the mod log.
test('truncates a title that would exceed Discord embed limit', () => {
	const embed = buildCaseEmbed(makeCase({ reason: 'x'.repeat(500) }));

	expect(embed.title!.length).toBeLessThanOrEqual(256);
	expect(embed.title!.endsWith('…')).toBe(true);
});

test('leaves a title that fits alone', () => {
	expect(buildCaseEmbed(makeCase({ reason: 'spam' })).title).toBe('Was banned for spam');
});

test('formats a user tag, dropping the post-pomelo placeholder discriminator', () => {
	expect(formatCaseUserTag({ username: 'someone', discriminator: '0' })).toBe('someone');
	expect(formatCaseUserTag({ username: 'someone' })).toBe('someone');
	expect(formatCaseUserTag({ username: 'someone', discriminator: null })).toBe('someone');
	// A legacy account that never migrated keeps its discriminator, so migrated rows read the same at P9.
	expect(formatCaseUserTag({ username: 'someone', discriminator: '1234' })).toBe('someone#1234');
});

test('formats durations down to the largest whole unit', () => {
	expect(formatCaseDuration(2 * 86_400_000)).toBe('2 days');
	expect(formatCaseDuration(86_400_000)).toBe('1 day');
	expect(formatCaseDuration(3_600_000)).toBe('1 hour');
	expect(formatCaseDuration(90_000)).toBe('2 minutes');
	expect(formatCaseDuration(1_000)).toBe('1 second');
	expect(formatCaseDuration(10)).toBe('a moment');
});

// #377. The case row stores a tag snapshot and no avatar, so the icon is the caller's to resolve -- and an
// author line has to render perfectly well without one, because a target Discord cannot resolve has none.
test('puts the resolved target avatar on the author line, and copes without one', () => {
	const withAvatar = buildCaseEmbed(makeCase(), { targetAvatarURL: 'https://cdn.discordapp.com/avatars/2/hash.png' });
	expect(withAvatar.author).toEqual({
		name: 'target (2)',
		icon_url: 'https://cdn.discordapp.com/avatars/2/hash.png',
	});

	expect(buildCaseEmbed(makeCase()).author).toEqual({ name: 'target (2)' });
});

// #381. The bare number is the fallback for every surface, not an error state: a guild with no mod log still
// has case numbers, they are just not clickable.
test('formats a case number, hyperlinked only when there is a message to jump to', () => {
	expect(formatCaseNumber(7)).toBe('#7');
	expect(formatCaseNumber(7, { guildId: '1' })).toBe('#7');
	expect(formatCaseNumber(7, { guildId: '1', logChannelId: '55' })).toBe('#7');
	expect(formatCaseNumber(7, { guildId: '1', logMessageId: '99' })).toBe('#7');
	expect(formatCaseNumber(7, { guildId: '1', logChannelId: '55', logMessageId: '99' })).toBe(
		'[#7](https://discord.com/channels/1/55/99)',
	);
});

// #381. A mod log pointed at a thread stores the thread's *parent* in `channel_id`, because the webhook belongs
// to the parent and reaches the thread through `?thread_id=` -- so a link built from that column names a channel
// the message is not in, and Discord resolves it to nothing.
test('links into the thread when the log webhook has one', () => {
	expect(logJumpChannelId({ channelId: '55', threadId: null })).toBe('55');
	expect(logJumpChannelId({ channelId: '55', threadId: '66' })).toBe('66');
	expect(logJumpChannelId(null)).toBeNull();
	expect(logJumpChannelId(undefined)).toBeNull();
});
