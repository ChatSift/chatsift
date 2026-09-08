import { expect, test, vi } from 'vitest';

// `ticketCreation.ts` pulls in modules that build a `RedisStore` and read env at import time. Nothing
// under test here goes near either (`formatRoleList` is pure), so bare stubs are enough to make the
// import work -- same approach `emojis.test.ts` takes.
vi.mock('@chatsift/backend-core', () => ({
	RedisStore: class {},
	getContext: () => ({}),
}));

const { formatRoleList } = await import('../ticketCreation.js');

const roleIds = (count: number) =>
	Array.from({ length: count }, (_, index) => String(1_000_000_000_000_000_000n + BigInt(index)));

test('a member with no roles reads as none', () => {
	expect(formatRoleList([])).toBe('none');
});

test('a short role list is rendered whole', () => {
	expect(formatRoleList(roleIds(3))).toBe('<@&1000000000000000000>, <@&1000000000000000001>, <@&1000000000000000002>');
});

test('a role list past the field cap is truncated with a count of the rest', () => {
	// 61 roles is what actually 400'd the ticket-opening request in production.
	const value = formatRoleList(roleIds(61));

	expect(value.length).toBeLessThanOrEqual(1_024);
	const tail = / and (?<dropped>\d+) more$/.exec(value);
	expect(tail).not.toBeNull();

	const shown = value.slice(0, value.indexOf(' and ')).split(', ');
	expect(shown.length + Number(tail!.groups!['dropped'])).toBe(61);
});

test('the last mention is never left half-written', () => {
	for (const count of [40, 45, 61, 250]) {
		const value = formatRoleList(roleIds(count));
		expect(value.length).toBeLessThanOrEqual(1_024);
		expect(value).not.toMatch(/<@&\d*$/);
	}
});
