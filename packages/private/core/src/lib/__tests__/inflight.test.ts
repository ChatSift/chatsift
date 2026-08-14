import { expect, test, vi } from 'vitest';
import { createInflightDeduper, memoizeAsync } from '../inflight.js';

test('memoizeAsync runs the lookup once and reuses the answer', async () => {
	const fetch = vi.fn(async () => 'value');
	const memoized = memoizeAsync(fetch);

	await expect(memoized()).resolves.toBe('value');
	await expect(memoized()).resolves.toBe('value');
	expect(fetch).toHaveBeenCalledTimes(1);
});

test('memoizeAsync collapses concurrent callers onto one lookup', async () => {
	const fetch = vi.fn(async () => 'value');
	const memoized = memoizeAsync(fetch);

	await Promise.all([memoized(), memoized(), memoized()]);
	expect(fetch).toHaveBeenCalledTimes(1);
});

test('memoizeAsync does not remember a failure', async () => {
	const fetch = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('value');

	const memoized = memoizeAsync(fetch);

	await expect(memoized()).rejects.toThrow('transient');
	await expect(memoized()).resolves.toBe('value');
	expect(fetch).toHaveBeenCalledTimes(2);
});

test('memoizeAsync does not remember a synchronous throw either', async () => {
	let calls = 0;
	// eslint-disable-next-line @typescript-eslint/promise-function-async
	const memoized = memoizeAsync<string>(() => {
		calls++;
		if (calls === 1) {
			throw new Error('sync');
		}

		return Promise.resolve('value');
	});

	await expect(memoized()).rejects.toThrow('sync');
	await expect(memoized()).resolves.toBe('value');
});

test('memoizeAsync propagates a rejection to every concurrent caller', async () => {
	const fetch = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('down'));
	const memoized = memoizeAsync(fetch);

	const results = await Promise.allSettled([memoized(), memoized()]);
	expect(results.every((result) => result.status === 'rejected')).toBe(true);
	expect(fetch).toHaveBeenCalledTimes(1);
});

test('createInflightDeduper keeps nothing once a promise settles', async () => {
	const fetch = vi.fn(async () => 'value');
	const deduper = createInflightDeduper();

	await deduper.run('key', fetch);
	await deduper.run('key', fetch);

	expect(fetch).toHaveBeenCalledTimes(2);
});
