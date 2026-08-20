import { expect, test, vi } from 'vitest';

let calls = 0;
let bypassRows: { roleId: string }[] = [];

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({
		async db() {
			calls += 1;
			return bypassRows;
		},
	}),
}));

const { findBypassRole } = await import('../bypassRoles.js');

// The member lookup that produces `roleIds` is the expensive half of this check, and a member with no roles
// cannot hold a bypass role -- so this short-circuits before the query rather than after it.
test('a member with no roles never reaches the database', async () => {
	calls = 0;
	bypassRows = [{ roleId: 'staff' }];

	expect(await findBypassRole('1', [])).toBeNull();
	expect(calls).toBe(0);
});

test('the bypassing role is named, not just detected', async () => {
	bypassRows = [{ roleId: 'staff' }, { roleId: 'admin' }];

	// Returned rather than a boolean so the decision trace and the filter log can say *which* role let them off.
	expect(await findBypassRole('1', ['member', 'admin'])).toBe('admin');
});

test('a member holding none of them is not exempt', async () => {
	bypassRows = [{ roleId: 'staff' }];

	expect(await findBypassRole('1', ['member'])).toBeNull();
});

test('a guild with no bypass roles configured exempts nobody', async () => {
	bypassRows = [];

	expect(await findBypassRole('1', ['staff'])).toBeNull();
});
