import type { AutomoderatorBanwordPolicies } from '@chatsift/db';
import { expect, test, vi } from 'vitest';

const queries: unknown[][] = [];
let rows: AutomoderatorBanwordPolicies[] = [];

// The precedence this tests is resolved in memory off one read, so the db only has to hand back rows and
// record what it was asked for -- the lowercasing assertion below is about an interpolated value, not a result.
vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({
		async db(_strings: TemplateStringsArray, ...values: unknown[]) {
			queries.push(values);
			return rows;
		},
	}),
}));

const { resolveBanwordPolicy } = await import('../banwordPolicy.js');

function policy(keyword: string | null, actionType = 'WARN'): AutomoderatorBanwordPolicies {
	return { id: 1, guildId: '1', ruleId: 'rule', keyword, actionType, durationSeconds: null } as unknown as AutomoderatorBanwordPolicies;
}

test('a keyword policy beats the rule-level one it is an exception to', async () => {
	rows = [policy(null, 'WARN'), policy('slur', 'BAN')];

	const resolved = await resolveBanwordPolicy('1', 'rule', 'slur');

	expect(resolved?.scope).toBe('keyword');
	expect(resolved?.policy.actionType).toBe('BAN');
});

test('the rule-level policy answers when no keyword one does', async () => {
	rows = [policy(null, 'WARN')];

	const resolved = await resolveBanwordPolicy('1', 'rule', 'slur');

	expect(resolved?.scope).toBe('rule');
	expect(resolved?.policy.actionType).toBe('WARN');
});

test('a rule with no policy at all resolves to nothing', async () => {
	rows = [];

	expect(await resolveBanwordPolicy('1', 'rule', 'slur')).toBeNull();
});

// Discord's own matching is case-insensitive, and `services/api` lowercases keywords on write -- so the lookup
// has to meet the column rather than the payload, or a rule storing `Foo` would never match a policy again.
test('the matched keyword is lowercased to meet the column', async () => {
	rows = [];
	queries.length = 0;

	await resolveBanwordPolicy('1', 'rule', 'FooBar');

	expect(queries.at(-1)).toContain('foobar');
});

// A preset rule matches against a word list Discord does not expose, so its events carry no keyword. Only the
// rule-level policy can answer, which is exactly what the nullable keyword column exists for.
test('an event with no keyword passes null, so only a rule-level policy can match', async () => {
	rows = [policy(null, 'KICK')];
	queries.length = 0;

	const resolved = await resolveBanwordPolicy('1', 'rule', null);

	expect(queries.at(-1)).toContain(null);
	expect(resolved?.scope).toBe('rule');
});
