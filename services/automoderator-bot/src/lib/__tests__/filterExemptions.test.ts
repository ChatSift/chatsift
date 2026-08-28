import { beforeEach, expect, test, vi } from 'vitest';

let rows: { channelId: string; filter: string }[] = [];
let lastValues: unknown[] = [];
let queries = 0;

let chain: string[] = [];
let chainCalls = 0;

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({
		async db(_strings: TemplateStringsArray, ...values: unknown[]) {
			queries += 1;
			lastValues = values;
			return rows;
		},
		service: { client: { api: {} } },
	}),
}));

vi.mock('@chatsift/bot-core', () => ({
	async resolveChannelChain() {
		chainCalls += 1;
		return chain;
	},
}));

const { findFilterExemptions } = await import('../filterExemptions.js');

beforeEach(() => {
	rows = [];
	lastValues = [];
	queries = 0;
	chain = [];
	chainCalls = 0;
});

// The short-circuit that keeps this free for the guilds that have configured nothing, which is almost all of
// them: no exemption rows means the channel tree is never walked.
test('a guild with no exemptions never resolves the channel chain', async () => {
	const found = await findFilterExemptions('1', 'channel', ['URLS', 'INVITES']);

	expect(found.size).toBe(0);
	expect(queries).toBe(1);
	expect(chainCalls).toBe(0);
});

test('an exemption on the channel itself matches', async () => {
	rows = [{ channelId: 'channel', filter: 'URLS' }];
	chain = ['channel', 'parent', 'category'];

	const found = await findFilterExemptions('1', 'channel', ['URLS']);

	expect(found.get('URLS')).toBe('channel');
});

// The thing legacy got wrong in the other direction: it resolved the parent and the category but dropped the
// message's own channel when that channel was a thread, so exempting a thread by id did nothing at all.
test('an exemption on the category covers a thread three levels down', async () => {
	rows = [{ channelId: 'category', filter: 'INVITES' }];
	chain = ['thread', 'parent', 'category'];

	const found = await findFilterExemptions('1', 'thread', ['INVITES']);

	// Names the row that granted it, not just "yes" -- "which one do I delete" is the follow-up question.
	expect(found.get('INVITES')).toBe('category');
});

test('exemptions are per filter, not per channel', async () => {
	rows = [{ channelId: 'channel', filter: 'URLS' }];
	chain = ['channel'];

	const found = await findFilterExemptions('1', 'channel', ['URLS', 'INVITES']);

	expect(found.get('URLS')).toBe('channel');
	expect(found.has('INVITES')).toBe(false);
});

// Both filters resolve off one read and one walk, which is what makes running two filters cost the same as
// running one.
test('two filters cost one query and one chain walk', async () => {
	rows = [
		{ channelId: 'category', filter: 'URLS' },
		{ channelId: 'channel', filter: 'INVITES' },
	];
	chain = ['channel', 'parent', 'category'];

	const found = await findFilterExemptions('1', 'channel', ['URLS', 'INVITES']);

	expect(found.get('URLS')).toBe('category');
	expect(found.get('INVITES')).toBe('channel');
	expect(queries).toBe(1);
	expect(chainCalls).toBe(1);
});

test('a channel outside the chain does not match', async () => {
	rows = [{ channelId: 'somewhere-else', filter: 'URLS' }];
	chain = ['channel', 'parent'];

	const found = await findFilterExemptions('1', 'channel', ['URLS']);

	expect(found.size).toBe(0);
});

test('the lookup is scoped to the guild and the asked-for filters', async () => {
	rows = [];

	await findFilterExemptions('9876', 'channel', ['URLS']);

	expect(lastValues).toContain('9876');
	expect(lastValues).toContainEqual(['URLS']);
});
