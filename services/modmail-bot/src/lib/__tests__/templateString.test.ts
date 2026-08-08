import { expect, test } from 'vitest';
import { templateString } from '../templateString.js';

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
