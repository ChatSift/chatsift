import { expect, test } from 'vitest';
import type { CaseEmbedInput } from '../automoderatorCaseEmbeds.js';
import { buildCaseEmbed, formatCaseDuration } from '../automoderatorCaseEmbeds.js';

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

test('formats durations down to the largest whole unit', () => {
	expect(formatCaseDuration(2 * 86_400_000)).toBe('2 days');
	expect(formatCaseDuration(86_400_000)).toBe('1 day');
	expect(formatCaseDuration(3_600_000)).toBe('1 hour');
	expect(formatCaseDuration(90_000)).toBe('2 minutes');
	expect(formatCaseDuration(1_000)).toBe('1 second');
	expect(formatCaseDuration(10)).toBe('a moment');
});
