import { beforeEach, expect, test, vi } from 'vitest';
import { REALTIME_INVALIDATE_CHANNEL, publishRealtimeInvalidate } from '../realtimeBroadcast.js';

const publish = vi.fn();
const warn = vi.fn();

// `realtimeBroadcast.ts` reaches for the redis client and logger through `getContext()` at call time, so
// stubbing the context is enough -- no real connection, and vitest hoists this above the static import above.
vi.mock('../context.js', () => ({
	getContext: () => ({ redis: { publish }, logger: { warn } }),
}));

function published(): { channel: string; originClientId?: string; type: string }[] {
	return publish.mock.calls.map((call) => JSON.parse(call[1] as string));
}

beforeEach(() => {
	publish.mockReset().mockResolvedValue(1);
	warn.mockReset();
});

test('publishes a single channel on the shared invalidate channel', async () => {
	await publishRealtimeInvalidate('ama-questions:123:1');

	expect(publish).toHaveBeenCalledOnce();
	expect(publish.mock.calls[0]![0]).toBe(REALTIME_INVALIDATE_CHANNEL);
	expect(published()).toStrictEqual([{ type: 'invalidate', channel: 'ama-questions:123:1' }]);
});

test('publishes one message per channel when given several', async () => {
	// The WS subscriber dispatches on a single `channel`, so a batch is still n messages -- what the array
	// form saves is issuing them in one tick (pipelined) rather than n sequential round trips.
	await publishRealtimeInvalidate(['ama-questions:123:1', 'ama-public:1']);

	expect(publish).toHaveBeenCalledTimes(2);
	expect(published()).toStrictEqual([
		{ type: 'invalidate', channel: 'ama-questions:123:1' },
		{ type: 'invalidate', channel: 'ama-public:1' },
	]);
});

test('tags every channel in a batch with the same originClientId', async () => {
	await publishRealtimeInvalidate(['ama-questions:123:1', 'ama-public:1'], 'tab-abc');

	expect(published()).toStrictEqual([
		{ type: 'invalidate', channel: 'ama-questions:123:1', originClientId: 'tab-abc' },
		{ type: 'invalidate', channel: 'ama-public:1', originClientId: 'tab-abc' },
	]);
});

test('omits originClientId entirely when absent, rather than sending undefined', async () => {
	await publishRealtimeInvalidate('ama-questions:123:1');

	expect(published()[0]).not.toHaveProperty('originClientId');
});

test('is a no-op for an empty batch', async () => {
	await publishRealtimeInvalidate([]);

	expect(publish).not.toHaveBeenCalled();
	expect(warn).not.toHaveBeenCalled();
});

test('swallows and logs a failed publish instead of throwing at the caller', async () => {
	// The mutation that triggered this has already committed by the time any call site gets here -- a missed
	// live refresh must not turn into a failed request.
	publish.mockRejectedValue(new Error('redis is down'));

	await expect(publishRealtimeInvalidate(['ama-questions:123:1', 'ama-public:1'])).resolves.toBeUndefined();
	expect(warn).toHaveBeenCalledOnce();
	expect(warn.mock.calls[0]![0]).toMatchObject({ channels: ['ama-questions:123:1', 'ama-public:1'] });
});
