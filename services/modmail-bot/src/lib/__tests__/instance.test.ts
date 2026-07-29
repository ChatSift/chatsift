import { afterEach, expect, test, vi } from 'vitest';

const { fakeGetSelfInstance, fakeGetInstanceForGuild, fakeGetCustomInstanceGuildIds } = vi.hoisted(() => ({
	fakeGetSelfInstance: vi.fn(),
	fakeGetInstanceForGuild: vi.fn(),
	fakeGetCustomInstanceGuildIds: vi.fn(),
}));

// Only the three registry accessors `lib/instance.ts` actually reads -- no need to pull in (or satisfy
// the env schema of) the real `@chatsift/backend-core`, since none of its other exports are touched here.
vi.mock('@chatsift/backend-core', () => ({
	getSelfInstance: fakeGetSelfInstance,
	getInstanceForGuild: fakeGetInstanceForGuild,
	getCustomInstanceGuildIds: fakeGetCustomInstanceGuildIds,
}));

const { getOwnershipScope, ownsGuild, resolveGuildOwnerLabel } = await import('../instance.js');

afterEach(() => {
	vi.clearAllMocks();
});

test('as the public deployment (no self instance), ownsGuild is true for any guild with no registry row', () => {
	fakeGetSelfInstance.mockReturnValue(null);
	fakeGetCustomInstanceGuildIds.mockReturnValue(new Set(['partner-guild']));

	expect(ownsGuild('random-guild')).toBe(true);
	expect(ownsGuild('partner-guild')).toBe(false);
});

test('as a custom instance, ownsGuild is true only for its own guild', () => {
	fakeGetSelfInstance.mockReturnValue({ id: 'partner-a', guildId: 'partner-guild', label: 'Partner A', token: 'x' });

	expect(ownsGuild('partner-guild')).toBe(true);
	expect(ownsGuild('some-other-guild')).toBe(false);
});

test('getOwnershipScope is "excluding" the custom guild ids for the public deployment', () => {
	fakeGetSelfInstance.mockReturnValue(null);
	fakeGetCustomInstanceGuildIds.mockReturnValue(new Set(['partner-guild', 'other-partner-guild']));

	expect(getOwnershipScope()).toEqual({
		kind: 'excluding',
		excludedGuildIds: expect.arrayContaining(['partner-guild', 'other-partner-guild']),
	});
});

test('getOwnershipScope is "only" its own guild for a custom instance', () => {
	fakeGetSelfInstance.mockReturnValue({ id: 'partner-a', guildId: 'partner-guild', label: 'Partner A', token: 'x' });

	expect(getOwnershipScope()).toEqual({ kind: 'only', guildId: 'partner-guild' });
});

test('resolveGuildOwnerLabel returns null for a guild this deployment owns', () => {
	fakeGetSelfInstance.mockReturnValue(null);
	fakeGetCustomInstanceGuildIds.mockReturnValue(new Set());

	expect(resolveGuildOwnerLabel('any-guild')).toBeNull();
});

test('resolveGuildOwnerLabel returns the owning custom instance label as seen from the public deployment', () => {
	fakeGetSelfInstance.mockReturnValue(null);
	fakeGetCustomInstanceGuildIds.mockReturnValue(new Set(['partner-guild']));
	fakeGetInstanceForGuild.mockReturnValue({
		id: 'partner-a',
		guildId: 'partner-guild',
		label: 'Partner A',
		token: 'x',
	});

	expect(resolveGuildOwnerLabel('partner-guild')).toBe('Partner A');
});

test('resolveGuildOwnerLabel falls back to the public label as seen from a foreign custom instance', () => {
	fakeGetSelfInstance.mockReturnValue({ id: 'partner-a', guildId: 'partner-guild', label: 'Partner A', token: 'x' });
	fakeGetInstanceForGuild.mockReturnValue(null);

	expect(resolveGuildOwnerLabel('some-public-guild')).toBe('the public ModMail bot');
});
