import type { AutomoderatorCaseAction, AutomoderatorCases } from '@chatsift/db';
import type { APIUser } from '@discordjs/core';
import { expect, test } from 'vitest';
import { buildHistoryEmbed } from '../caseHistory.js';

const USER = { id: '2', username: 'target', discriminator: '0' } as APIUser;

let nextId = 0;

function makeCase(action: string, overrides: Partial<AutomoderatorCases> = {}): AutomoderatorCases {
	nextId++;

	return {
		id: nextId as AutomoderatorCases['id'],
		guildId: '1',
		caseId: nextId,
		refId: null,
		targetId: '2',
		targetTag: 'target',
		modId: '3',
		modTag: 'mod',
		actionType: action as unknown as AutomoderatorCaseAction,
		reason: null,
		expiresAt: null,
		liftedAt: null,
		pardonedBy: null,
		logMessageId: null,
		dryRun: false,
		idempotencyKey: null,
		createdAt: new Date('2026-08-14T12:00:00.000Z'),
		...overrides,
	};
}

test('says so plainly when a user has no history', () => {
	const embed = buildHistoryEmbed(USER, []);
	expect(embed.description).toBe('This user has not been punished before.');
});

// Pardoning is what stops a warn counting against someone, so a history of nothing but pardoned warns has to
// read as clean -- in the colour as well as the list.
test('excludes pardoned cases entirely', () => {
	const embed = buildHistoryEmbed(USER, [makeCase('WARN', { pardonedBy: '9' })]);
	expect(embed.description).toBe('This user has not been punished before.');
});

test('summarizes counts by action, pluralized', () => {
	const embed = buildHistoryEmbed(USER, [makeCase('BAN'), makeCase('WARN'), makeCase('WARN')]);
	expect(embed.footer?.text).toBe('1 ban | 2 warns');
});

test('colours by accumulated severity', () => {
	const clean = buildHistoryEmbed(USER, [makeCase('UNBAN')]);
	const low = buildHistoryEmbed(USER, [makeCase('WARN')]);
	const high = buildHistoryEmbed(USER, [makeCase('BAN')]);

	// An unban carries no severity points, so a history of only undo actions is still green.
	expect(clean.color).not.toBe(low.color);
	expect(low.color).not.toBe(high.color);
});

test('links a case number to its log message when there is one', () => {
	const embed = buildHistoryEmbed(USER, [makeCase('BAN', { logMessageId: '99' })], { logChannelId: '55' });
	expect(embed.description).toContain('https://discord.com/channels/1/55/99');
});

test('leaves the case number plain when the guild has no mod log', () => {
	const embed = buildHistoryEmbed(USER, [makeCase('BAN', { logMessageId: '99' })]);
	expect(embed.description).not.toContain('https://');
});

test('truncates a long history and says how many are left', () => {
	const cases = Array.from({ length: 20 }, () => makeCase('WARN'));
	const embed = buildHistoryEmbed(USER, cases);

	expect(embed.description).toContain('…and 5 more.');
});

// #377: `/history`, `/myhistory` and the History context menu all hand over a resolved Discord user, so the
// avatar costs nothing -- including for the clean-history embed, which is the one most people ever see.
test('draws the user avatar on the author line, clean history included', () => {
	const withAvatar = { ...USER, avatar: 'hash' } as APIUser;

	expect(buildHistoryEmbed(withAvatar, []).author).toEqual({
		name: 'target (2)',
		icon_url: 'https://cdn.discordapp.com/avatars/2/hash.png',
	});

	expect(buildHistoryEmbed(withAvatar, [makeCase('BAN')]).author?.icon_url).toBe(
		'https://cdn.discordapp.com/avatars/2/hash.png',
	);
});
