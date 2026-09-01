import { beforeEach, expect, test, vi } from 'vitest';

interface Settings {
	antispamAmount: number | null;
	antispamTime: number | null;
	useInviteFilters: boolean;
	useUrlFilters: boolean;
}

let settings: Settings | undefined;
let bypassRoleId: string | null = null;
let bypassCalls = 0;
let exemptions = new Map<string, string>();
let exemptionCalls = 0;
let ran: string[] = [];
let urlHit: { forbidden: string[] } | null = null;
let inviteHit: { forbidden: string[] } | null = null;
let burst: { messages: { channelId: string; messageId: string }[] } | null = null;

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
	FILTER_KIND: { URLS: 'URLS', INVITES: 'INVITES', ANTISPAM: 'ANTISPAM' },
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

// `resolveAntispamSettings` is the real one -- it is the function that decides whether anti-spam is on at all,
// which is half of what these tests are checking. Only the redis-backed window is stubbed.
vi.mock('../antispam.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../antispam.js')>()),
	async recordMessage() {
		ran.push('ANTISPAM');
		return burst;
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

/**
 * The live path: `/simulate` passes no `message`, and every anti-spam case below turns on that difference.
 */
const WITH_MESSAGE = {
	...INPUT,
	message: { authorId: 'author', channelId: 'channel', messageId: 'message' },
};

beforeEach(() => {
	settings = { useUrlFilters: true, useInviteFilters: true, antispamAmount: null, antispamTime: null };
	bypassRoleId = null;
	bypassCalls = 0;
	exemptions = new Map();
	exemptionCalls = 0;
	ran = [];
	urlHit = { forbidden: ['evil.com'] };
	inviteHit = { forbidden: ['abc'] };
	burst = null;
});

// Cheapest gate first: a guild that has turned nothing on must not pay for the bypass read, the exemption read
// or any runner. That is every guild the bot is in, for every message, until somebody configures this.
test('a guild with every filter off runs nothing at all', async () => {
	settings = { useUrlFilters: false, useInviteFilters: false, antispamAmount: null, antispamTime: null };

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
	settings = { useUrlFilters: true, useInviteFilters: false, antispamAmount: null, antispamTime: null };

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
	settings = { useUrlFilters: false, useInviteFilters: false, antispamAmount: null, antispamTime: null };
	const resolveRoleIds = vi.fn(async () => []);

	await evaluateFilters({ ...INPUT, resolveRoleIds });

	expect(resolveRoleIds).not.toHaveBeenCalled();
});

// Anti-spam has no `use_antispam` flag: both thresholds being set is what turns it on. Half a pair must read as
// off rather than as on-with-an-undefined-window, which is a filter that can never fire and says so nowhere.
test('anti-spam is on only when both thresholds are set', async () => {
	settings = { useUrlFilters: false, useInviteFilters: false, antispamAmount: 5, antispamTime: 5 };
	expect((await evaluateFilters(WITH_MESSAGE)).enabled).toEqual(['ANTISPAM']);

	settings = { useUrlFilters: false, useInviteFilters: false, antispamAmount: 5, antispamTime: null };
	expect((await evaluateFilters(WITH_MESSAGE)).enabled).toEqual([]);

	settings = { useUrlFilters: false, useInviteFilters: false, antispamAmount: null, antispamTime: 5 };
	expect((await evaluateFilters(WITH_MESSAGE)).enabled).toEqual([]);
});

// `/simulate` passes no message, and recording a hypothetical one would corrupt the real window. The filter
// still reports as *enabled* -- the command says why it isn't simulated, which is not the same as "off".
test('anti-spam does not run without a message, but still reports as enabled', async () => {
	settings = { useUrlFilters: false, useInviteFilters: false, antispamAmount: 2, antispamTime: 5 };
	burst = { messages: [{ channelId: 'channel', messageId: 'message' }] };

	const evaluation = await evaluateFilters(INPUT);

	expect(evaluation.enabled).toEqual(['ANTISPAM']);
	expect(ran).toEqual([]);
	expect(evaluation.verdicts).toEqual([]);
});

// The burst travels on the verdict, because it is what the deletion pass has to widen to -- deleting only the
// message that tipped the threshold leaves the spam in the channel.
test('an anti-spam hit carries the whole burst', async () => {
	settings = { useUrlFilters: false, useInviteFilters: false, antispamAmount: 2, antispamTime: 5 };
	burst = {
		messages: [
			{ channelId: 'channel', messageId: 'first' },
			{ channelId: 'other', messageId: 'message' },
		],
	};

	const evaluation = await evaluateFilters(WITH_MESSAGE);

	expect(evaluation.verdicts).toEqual([
		{
			kind: 'ANTISPAM',
			matched: ['2 messages in 5s'],
			messages: [
				{ channelId: 'channel', messageId: 'first' },
				{ channelId: 'other', messageId: 'message' },
			],
		},
	]);
});

// A bypass role keeps staff messages out of the window entirely rather than letting a burst accumulate that
// could never trip -- which also means `recordMessage` is never reached for them.
test('a bypass role stops anti-spam before the message is recorded', async () => {
	settings = { useUrlFilters: false, useInviteFilters: false, antispamAmount: 2, antispamTime: 5 };
	bypassRoleId = 'staff';

	await evaluateFilters(WITH_MESSAGE);

	expect(ran).toEqual([]);
});
