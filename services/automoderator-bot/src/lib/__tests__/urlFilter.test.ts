import { beforeEach, expect, test, vi } from 'vitest';

let allowRows: { domain: string }[] = [];
let queries = 0;

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({
		async db() {
			queries += 1;
			return allowRows;
		},
	}),
}));

const { runUrlFilter } = await import('../urlFilter.js');

beforeEach(() => {
	allowRows = [];
	queries = 0;
});

// The overwhelmingly common message contains no link, and must cost nothing.
test('a message with no links never reaches the database', async () => {
	expect(await runUrlFilter('1', 'no links here, just talk about example.com')).toBeNull();
	expect(queries).toBe(0);
});

test('a link to an unallowed domain is forbidden', async () => {
	expect(await runUrlFilter('1', 'look at https://evil.com/x')).toEqual({ forbidden: ['evil.com'] });
});

test('a link to an allowed domain is let through', async () => {
	allowRows = [{ domain: 'example.com' }];

	expect(await runUrlFilter('1', 'look at https://example.com/x')).toBeNull();
});

test('a subdomain of an allowed domain is let through', async () => {
	allowRows = [{ domain: 'example.com' }];

	expect(await runUrlFilter('1', 'https://cdn.example.com/img.png')).toBeNull();
});

// Not an unconfigured state: the guild had to turn the filter on to get here, and "no links at all" is a
// setting some servers genuinely want.
test('an empty allowlist forbids every link', async () => {
	expect(await runUrlFilter('1', 'https://example.com')).toEqual({ forbidden: ['example.com'] });
});

test('only the forbidden hosts are reported, in order', async () => {
	allowRows = [{ domain: 'example.com' }];

	expect(await runUrlFilter('1', 'https://a.com https://example.com https://b.com')).toEqual({
		forbidden: ['a.com', 'b.com'],
	});
});
