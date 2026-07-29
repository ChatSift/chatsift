import { afterEach, expect, test } from 'vitest';
import { resolveForeignOwnerLabel, setGuildOwnershipFilter } from '../ownership.js';

afterEach(() => {
	setGuildOwnershipFilter(() => null);
});

test('resolveForeignOwnerLabel returns null when no filter has been registered', () => {
	expect(resolveForeignOwnerLabel('any-guild')).toBeNull();
});

test('resolveForeignOwnerLabel returns null for a guild-less interaction, even with a filter registered', () => {
	setGuildOwnershipFilter(() => 'Some Partner ModMail');
	expect(resolveForeignOwnerLabel(undefined)).toBeNull();
});

test('resolveForeignOwnerLabel passes guildId through to the registered filter and returns its result', () => {
	setGuildOwnershipFilter((guildId) => (guildId === 'foreign-guild' ? 'Some Partner ModMail' : null));

	expect(resolveForeignOwnerLabel('foreign-guild')).toBe('Some Partner ModMail');
	expect(resolveForeignOwnerLabel('owned-guild')).toBeNull();
});

test('a later setGuildOwnershipFilter call replaces the previous filter outright', () => {
	setGuildOwnershipFilter(() => 'First');
	setGuildOwnershipFilter(() => 'Second');

	expect(resolveForeignOwnerLabel('some-guild')).toBe('Second');
});
