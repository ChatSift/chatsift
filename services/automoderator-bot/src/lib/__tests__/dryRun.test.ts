import { beforeEach, expect, test, vi } from 'vitest';
import { resolveDryRun } from '../dryRun.js';

const env = { IS_PRODUCTION: false };
let rows: { dryRun: boolean }[] = [];
const query = vi.fn();

// The whole module is stubbed rather than `process.env` primed, because `ENV` is parsed at import time and
// this test needs to flip `IS_PRODUCTION` between cases.
vi.mock('@chatsift/backend-core', () => ({
	get ENV() {
		return env;
	},
	getContext: () => ({
		db: (...args: unknown[]) => {
			query(...args);
			return rows;
		},
	}),
}));

beforeEach(() => {
	env.IS_PRODUCTION = false;
	rows = [];
	query.mockReset();
});

test('production is always live, without even asking the database', async () => {
	env.IS_PRODUCTION = true;
	rows = [{ dryRun: true }];

	// The short-circuit is the invariant, not a default: a production guild can neither be put into dry-run
	// nor left stuck in it, and a row saying otherwise is ignored rather than honoured.
	expect(await resolveDryRun('1')).toBe(false);
	expect(await resolveDryRun('1', true)).toBe(false);
	expect(query).not.toHaveBeenCalled();
});

test('an unconfigured guild is in dry-run outside production', async () => {
	rows = [];

	expect(await resolveDryRun('1')).toBe(true);
});

test('the guild row decides outside production', async () => {
	rows = [{ dryRun: false }];
	expect(await resolveDryRun('1')).toBe(false);

	rows = [{ dryRun: true }];
	expect(await resolveDryRun('1')).toBe(true);
});

test('an invocation can force dry-run on, but never off', async () => {
	rows = [{ dryRun: false }];

	expect(await resolveDryRun('1', true)).toBe(true);
	// `false` means "no opinion", not "act for real" -- nothing reachable from inside an interaction may
	// escape the guild's setting.
	expect(await resolveDryRun('1', false)).toBe(false);
});
