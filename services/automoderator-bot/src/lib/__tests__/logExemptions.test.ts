import { beforeEach, expect, test, vi } from 'vitest';

let rows: { channelId: string }[] = [];
let lastValues: unknown[] = [];
let queries = 0;

let chain: string[] = [];
let chainCalls = 0;
let chainError: Error | null = null;

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
		if (chainError) {
			throw chainError;
		}

		return chain;
	},
}));

const { findLogExemption } = await import('../logExemptions.js');

beforeEach(() => {
	rows = [];
	lastValues = [];
	queries = 0;
	chain = [];
	chainCalls = 0;
	chainError = null;
});

// The state almost every guild is in, and the reason this can sit on the delete path at all: no rows means no
// channel lookups, ever.
test('a guild with no exemptions never resolves the channel chain', async () => {
	expect(await findLogExemption('1', 'channel')).toBeNull();
	expect(queries).toBe(1);
	expect(chainCalls).toBe(0);
});

test('an exemption on the channel itself matches', async () => {
	rows = [{ channelId: 'channel' }];
	chain = ['channel', 'parent', 'category'];

	expect(await findLogExemption('1', 'channel')).toBe('channel');
});

// What legacy got wrong in the other direction: it resolved the parent and the category but dropped the
// message's own channel when that channel was a thread, so exempting a thread by id did nothing at all.
test('an exemption on the category covers a thread three levels down', async () => {
	rows = [{ channelId: 'category' }];
	chain = ['thread', 'parent', 'category'];

	// The id that granted it rather than `true`, so the decision trace can name which row to delete.
	expect(await findLogExemption('1', 'thread')).toBe('category');
});

test('a channel outside the chain does not match', async () => {
	rows = [{ channelId: 'somewhere-else' }];
	chain = ['channel', 'parent'];

	expect(await findLogExemption('1', 'channel')).toBeNull();
});

// The deliberate direction stated in the module: an exemption that cannot be evaluated suppresses the log
// rather than guessing, and the caller counts the lost line as `outcome="failed"`.
test('a chain that cannot be resolved propagates rather than logging anyway', async () => {
	rows = [{ channelId: 'category' }];
	chainError = new Error('proxy restarting');

	await expect(findLogExemption('1', 'channel')).rejects.toThrow('proxy restarting');
});

test('the lookup is scoped to the guild', async () => {
	await findLogExemption('9876', 'channel');

	expect(lastValues).toContain('9876');
});
