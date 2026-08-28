import { beforeEach, expect, test, vi } from 'vitest';

let settings: { useInviteFilters: boolean; useUrlFilters: boolean } | undefined;
let bypassRoleId: string | null = null;
let bypassCalls = 0;
let exemptions = new Map<string, string>();
let exemptionCalls = 0;
let ran: string[] = [];
let urlHit: { forbidden: string[] } | null = null;
let inviteHit: { forbidden: string[] } | null = null;

// `filterRunner.ts` pulls in the whole action/log/cache stack at import time, so the mock has to satisfy
// everything those modules reach for at module scope -- not just what `evaluateFilters` itself calls.
vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	decrypt: (value: string) => value,
	RedisStore: class {
		public async get() {
			return null;
		}

		public async set() {}
	},
	getContext: () => ({
		async db() {
			return settings ? [settings] : [];
		},
		logger: { child: () => ({ info() {}, warn() {}, error() {} }) },
		service: { client: { api: {} } },
	}),
}));

vi.mock('../bypassRoles.js', () => ({
	async findBypassRole() {
		bypassCalls += 1;
		return bypassRoleId;
	},
}));

vi.mock('../filterExemptions.js', () => ({
	FILTER_KIND: { URLS: 'URLS', INVITES: 'INVITES' },
	async findFilterExemptions() {
		exemptionCalls += 1;
		return exemptions;
	},
}));

vi.mock('../urlFilter.js', () => ({
	async runUrlFilter() {
		ran.push('URLS');
		return urlHit;
	},
}));

vi.mock('../inviteFilter.js', () => ({
	async runInviteFilter() {
		ran.push('INVITES');
		return inviteHit;
	},
}));

const { evaluateFilters } = await import('../filterRunner.js');

const INPUT = {
	guildId: '1',
	channelId: 'channel',
	content: 'https://evil.com discord.gg/abc',
	async resolveRoleIds() {
		return [];
	},
};

beforeEach(() => {
	settings = { useUrlFilters: true, useInviteFilters: true };
	bypassRoleId = null;
	bypassCalls = 0;
	exemptions = new Map();
	exemptionCalls = 0;
	ran = [];
	urlHit = { forbidden: ['evil.com'] };
	inviteHit = { forbidden: ['abc'] };
});

// Cheapest gate first: a guild that has turned nothing on must not pay for the bypass read, the exemption read
// or any runner. That is every guild the bot is in, for every message, until somebody configures this.
test('a guild with both filters off runs nothing at all', async () => {
	settings = { useUrlFilters: false, useInviteFilters: false };

	const evaluation = await evaluateFilters(INPUT);

	expect(evaluation.enabled).toEqual([]);
	expect(bypassCalls).toBe(0);
	expect(exemptionCalls).toBe(0);
	expect(ran).toEqual([]);
});

test('a guild with no settings row at all is treated as off', async () => {
	settings = undefined;

	const evaluation = await evaluateFilters(INPUT);

	expect(evaluation.enabled).toEqual([]);
});

test('only the enabled filters run', async () => {
	settings = { useUrlFilters: true, useInviteFilters: false };

	const evaluation = await evaluateFilters(INPUT);

	expect(evaluation.enabled).toEqual(['URLS']);
	expect(ran).toEqual(['URLS']);
	expect(evaluation.verdicts).toEqual([{ kind: 'URLS', matched: ['evil.com'] }]);
});

// A bypass role stops every runner at once, so the exemption read and the invite resolutions behind it are
// work whose answer is already known.
test('a bypass role short-circuits before the exemption read and the runners', async () => {
	bypassRoleId = 'staff';

	const evaluation = await evaluateFilters(INPUT);

	expect(evaluation.bypassRoleId).toBe('staff');
	expect(evaluation.verdicts).toEqual([]);
	expect(exemptionCalls).toBe(0);
	expect(ran).toEqual([]);
});

test('an exempt channel drops that filter and leaves the other running', async () => {
	exemptions = new Map([['URLS', 'category']]);

	const evaluation = await evaluateFilters(INPUT);

	expect(evaluation.exemptions.get('URLS')).toBe('category');
	expect(ran).toEqual(['INVITES']);
	expect(evaluation.verdicts).toEqual([{ kind: 'INVITES', matched: ['abc'] }]);
});

test('a runner that matched nothing produces no verdict', async () => {
	urlHit = null;

	const evaluation = await evaluateFilters(INPUT);

	expect(ran).toEqual(expect.arrayContaining(['URLS', 'INVITES']));
	expect(evaluation.verdicts).toEqual([{ kind: 'INVITES', matched: ['abc'] }]);
});

test('both runners can trip on one message', async () => {
	const evaluation = await evaluateFilters(INPUT);

	expect(evaluation.verdicts).toEqual([
		{ kind: 'URLS', matched: ['evil.com'] },
		{ kind: 'INVITES', matched: ['abc'] },
	]);
});

// `/simulate` depends on this: the roles are resolved lazily so a guild with no filters on never pays for the
// member fetch that a `MESSAGE_UPDATE` without a member object would otherwise force.
test('roles are only resolved once a filter is actually on', async () => {
	settings = { useUrlFilters: false, useInviteFilters: false };
	const resolveRoleIds = vi.fn(async () => []);

	await evaluateFilters({ ...INPUT, resolveRoleIds });

	expect(resolveRoleIds).not.toHaveBeenCalled();
});
