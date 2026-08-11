import type { APIUser } from '@discordjs/core';
import { expect, test } from 'vitest';
import { templateDataFromMember, templateGuildName, templateString } from '../templateString.js';

test('{{name}} and {{ name }} resolve to the same value', () => {
	const data = { guildName: 'Test Guild' };

	expect(templateString('{{guildName}} Team', data)).toBe('Test Guild Team');
	expect(templateString('{{ guildName }} Team', data)).toBe('Test Guild Team');
});

test('an unknown placeholder falls back to the existing "[unknown template ...]" marker', () => {
	expect(templateString('Welcome, {{notAPlaceholder}}!', { guildName: 'Test Guild' })).toBe(
		'Welcome, [unknown template notAPlaceholder]!',
	);
});

// A placeholder that *is* known but has no value on this particular call (an anon-reply label templated
// with only a guild name) takes the same marker rather than rendering "undefined" at the user.
test('a known placeholder with no value supplied still gets the marker', () => {
	expect(templateString('Hi {{username}}', { guildName: 'Test Guild' })).toBe('Hi [unknown template username]');
});

test('every occurrence of a placeholder is replaced', () => {
	expect(templateString('{{guildName}} / {{guildName}}', { guildName: 'Test Guild' })).toBe('Test Guild / Test Guild');
});

test('text with no placeholders is returned unchanged', () => {
	expect(templateString('Just a greeting.', { guildName: 'Test Guild' })).toBe('Just a greeting.');
});

const user = { id: '1425493115053019319', username: 'didinele' } as APIUser;

// Rendered as a Discord `<t:SECONDS:D>` timestamp so it localizes to whoever's reading the ticket, rather
// than baking in the bot host's timezone.
test('a join date becomes a Discord date timestamp in seconds', () => {
	const data = templateDataFromMember('Test Guild', { joined_at: '2024-03-01T12:34:56.789Z' }, user);

	expect(data).toStrictEqual({
		guildName: 'Test Guild',
		joinDate: '<t:1709296496:D>',
		userId: '1425493115053019319',
		username: 'didinele',
	});
});

test('a member with no join date renders as unknown rather than an invalid timestamp', () => {
	expect(templateDataFromMember('Test Guild', { joined_at: null as never }, user).joinDate).toBe('unknown');
});

test('templateDataFromMember output feeds straight back into templateString', () => {
	const data = templateDataFromMember('Test Guild', { joined_at: '2024-03-01T12:34:56.789Z' }, user);

	expect(templateString('Hi {{username}}, welcome to {{guildName}} (joined {{joinDate}})', data)).toBe(
		'Hi didinele, welcome to Test Guild (joined <t:1709296496:D>)',
	);
});

// Used for the anon-reply author label, which has a guild in scope but no member/user the way a greeting does.
test('templateGuildName resolves the guild name and marks everything else unknown', () => {
	expect(templateGuildName('{{guildName}} Staff', 'Test Guild')).toBe('Test Guild Staff');
	expect(templateGuildName('{{username}}', 'Test Guild')).toBe('[unknown template username]');
});
