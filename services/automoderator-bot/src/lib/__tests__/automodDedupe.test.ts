import type { GatewayAutoModerationActionExecutionDispatchData } from '@discordjs/core';
import { beforeEach, expect, test, vi } from 'vitest';

/**
 * `SET NX PX` and nothing else: a key that already exists returns null, which is the whole contract
 * `claimAutomodExecution` reads. The keys are captured so the tests can assert what actually distinguishes one
 * trigger from the next, which is the part a boolean return would hide.
 */
class FakeRedis {
	public readonly keys = new Map<string, string>();

	public fail = false;

	public async set(key: string, value: string, options: { NX?: boolean }): Promise<string | null> {
		if (this.fail) {
			throw new Error('redis is down');
		}

		if (options.NX && this.keys.has(key)) {
			return null;
		}

		this.keys.set(key, value);
		return 'OK';
	}
}

let redis = new FakeRedis();
const warn = vi.fn();

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({ redis, logger: { warn } }),
}));

const { claimAutomodExecution, DEDUPE_TTL_MS } = await import('../automodDedupe.js');

function event(
	overrides: Partial<GatewayAutoModerationActionExecutionDispatchData> = {},
): GatewayAutoModerationActionExecutionDispatchData {
	return {
		guild_id: 'guild',
		rule_id: 'rule',
		user_id: 'user',
		content: 'buy my coin',
		...overrides,
	} as GatewayAutoModerationActionExecutionDispatchData;
}

beforeEach(() => {
	redis = new FakeRedis();
	warn.mockClear();
});

// The fan-out this exists for: one rule set to block *and* time out *and* alert dispatches three events
// carrying the same rule, user and match, and only the first may be acted on.
test('only the first event of a fan-out is claimed', async () => {
	const data = event({ message_id: 'message' });

	expect(await claimAutomodExecution(data)).toBe(true);
	expect(await claimAutomodExecution(data)).toBe(false);
	expect(await claimAutomodExecution(data)).toBe(false);
});

test('two different messages are two different triggers', async () => {
	expect(await claimAutomodExecution(event({ message_id: 'one' }))).toBe(true);
	expect(await claimAutomodExecution(event({ message_id: 'two' }))).toBe(true);
});

test('the same text from a different member is a different trigger', async () => {
	expect(await claimAutomodExecution(event({ user_id: 'first' }))).toBe(true);
	expect(await claimAutomodExecution(event({ user_id: 'second' }))).toBe(true);
});

// A *blocked* message never exists, so Discord sends no `message_id` -- which is exactly the configuration
// that fans out the most, and the reason the content fallback is not optional.
test('a blocked message with no id falls back to the content', async () => {
	expect(await claimAutomodExecution(event({ content: 'first' }))).toBe(true);
	expect(await claimAutomodExecution(event({ content: 'first' }))).toBe(false);
	expect(await claimAutomodExecution(event({ content: 'second' }))).toBe(true);
});

test('empty content falls through to the matched content', async () => {
	expect(await claimAutomodExecution(event({ content: '', matched_content: 'slur' }))).toBe(true);
	expect(await claimAutomodExecution(event({ content: '', matched_content: 'slur' }))).toBe(false);
	expect(await claimAutomodExecution(event({ content: '', matched_content: 'other' }))).toBe(true);
});

// The last resort, where the key degenerates to "this member tripped this rule". It still collapses the
// fan-out correctly; it only widens what else it collapses.
test('nothing to key on at all still collapses the fan-out', async () => {
	expect(await claimAutomodExecution(event({ content: '', matched_content: null }))).toBe(true);
	expect(await claimAutomodExecution(event({ content: '', matched_content: null }))).toBe(false);
});

// The key is a copy of the message we did not need to keep, so it is hashed. Worth asserting rather than
// trusting: it is one `??` away from being the text verbatim.
test('the message text never reaches the redis key', async () => {
	await claimAutomodExecution(event({ content: 'something incriminating' }));

	const [key] = [...redis.keys.keys()];
	expect(key).not.toContain('something incriminating');
	expect(key).toContain('automoderator:automod-exec:guild:rule:user:');
});

// Short-lived on purpose: the same text an hour later is a new offence. A permanent key on a content hash
// would silence a repeat offender forever.
test('the claim expires rather than standing forever', async () => {
	const set = vi.spyOn(redis, 'set');
	await claimAutomodExecution(event());

	expect(set).toHaveBeenCalledWith(expect.any(String), '1', { NX: true, PX: DEDUPE_TTL_MS });
	expect(DEDUPE_TTL_MS).toBeLessThan(60_000);
});

// Between "moderation happens twice" and "moderation stops", the first is the recoverable one.
test('a redis outage lets the event through rather than dropping it', async () => {
	redis.fail = true;

	expect(await claimAutomodExecution(event())).toBe(true);
	expect(warn).toHaveBeenCalled();
});
