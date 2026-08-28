import { Buffer } from 'node:buffer';
import { beforeEach, expect, test, vi } from 'vitest';

/**
 * A sorted set just faithful enough for the window: scored members, trimmed by score, read in score order.
 * Entries come back as `Buffer` because the real client maps blob strings to one -- which is exactly the detail
 * a `string`-returning fake would let `recordMessage` get wrong.
 */
class FakeSortedSets {
	public readonly sets = new Map<string, { score: number; value: string }[]>();

	public readonly expiries = new Map<string, number>();

	public async zAdd(key: string, member: { score: number; value: string }): Promise<void> {
		this.sets.set(key, [...(this.sets.get(key) ?? []), member]);
	}

	public async zRemRangeByScore(key: string, _min: string, max: number): Promise<void> {
		this.sets.set(key, (this.sets.get(key) ?? []).filter((member) => member.score > max));
	}

	public async pExpire(key: string, ms: number): Promise<void> {
		this.expiries.set(key, ms);
	}

	public async zRange(key: string): Promise<Buffer[]> {
		return [...(this.sets.get(key) ?? [])]
			.sort((left, right) => left.score - right.score)
			.map((member) => Buffer.from(member.value));
	}

	public async del(key: string): Promise<void> {
		this.sets.delete(key);
	}
}

let redis = new FakeSortedSets();

vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({ redis }),
}));

const { recordMessage, resolveAntispamSettings } = await import('../antispam.js');

const SETTINGS = { amount: 3, windowSeconds: 5 };
const KEY = 'automoderator:antispam:guild:author';

async function send(messageId: string, channelId = 'channel') {
	return recordMessage('guild', 'author', { channelId, messageId }, SETTINGS);
}

beforeEach(() => {
	redis = new FakeSortedSets();
	vi.useRealTimers();
});

test('a member under the threshold trips nothing', async () => {
	expect(await send('one')).toBeNull();
	expect(await send('two')).toBeNull();
});

// The message that tips the threshold has to be *in* the burst -- counting before recording would leave the
// offending message sitting in the channel every single time.
test('the message that tips the threshold is part of the burst', async () => {
	await send('one');
	await send('two');

	const hit = await send('three');

	expect(hit?.messages.map((message) => message.messageId)).toEqual(['one', 'two', 'three']);
});

// The window is keyed on the member, so a burst spread across channels is still one burst -- and the channel
// has to travel with each id, because that is what the per-channel delete needs.
test('a burst carries the channel each message was posted in', async () => {
	await send('one', 'general');
	await send('two', 'offtopic');

	const hit = await send('three', 'general');

	expect(hit?.messages).toEqual([
		{ channelId: 'general', messageId: 'one' },
		{ channelId: 'offtopic', messageId: 'two' },
		{ channelId: 'general', messageId: 'three' },
	]);
});

// Otherwise one flood files a punishment per message after the first, which is a ladder climbed six rungs at
// once for a single incident.
test('a burst clears the window so the next message starts fresh', async () => {
	await send('one');
	await send('two');
	await send('three');

	expect(redis.sets.get(KEY)).toBeUndefined();
	expect(await send('four')).toBeNull();
});

// The window slides. Three messages spread over a minute are not a burst, however tight the threshold is.
test('messages older than the window fall out of the count', async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-08-28T12:00:00Z'));
	await send('one');

	vi.setSystemTime(new Date('2026-08-28T12:00:10Z'));
	await send('two');
	expect(redis.sets.get(KEY)?.map((member) => member.value)).toEqual(['channel/two']);

	expect(await send('three')).toBeNull();
});

test('the key expires with the window rather than outliving the member', async () => {
	await send('one');

	expect(redis.expiries.get(KEY)).toBe(5_000);
});

// The pair is one setting. Half of it must read as off, not as on with an undefined window -- that is a filter
// that is enabled and can never fire, and nothing anywhere reports it.
test('anti-spam is configured only when both halves are numbers', () => {
	expect(resolveAntispamSettings({ antispamAmount: 5, antispamTime: 5 })).toEqual({ amount: 5, windowSeconds: 5 });
	expect(resolveAntispamSettings({ antispamAmount: 5, antispamTime: null })).toBeNull();
	expect(resolveAntispamSettings({ antispamAmount: null, antispamTime: 5 })).toBeNull();
	expect(resolveAntispamSettings({ antispamAmount: null, antispamTime: null })).toBeNull();
	// A row read with a narrower `SELECT` than the type promises, which a `!== null` check would wave through.
	expect(resolveAntispamSettings({} as { antispamAmount: number | null; antispamTime: number | null })).toBeNull();
});
