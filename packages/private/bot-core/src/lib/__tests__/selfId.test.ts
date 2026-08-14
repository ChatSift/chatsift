import type { API } from '@discordjs/core';
import { expect, test, vi } from 'vitest';

function makeApi(getCurrent: () => Promise<{ id: string }>): API {
	return { users: { getCurrent } } as unknown as API;
}

/**
 * Module-level state, so each test needs its own copy to stand in for a fresh process.
 */
async function freshModule() {
	vi.resetModules();
	return import('../selfId.js');
}

test('uses the id READY recorded, without asking Discord', async () => {
	const { getSelfId, setSelfId } = await freshModule();
	const getCurrent = vi.fn(async () => ({ id: 'fetched' }));

	setSelfId('from-ready');

	await expect(getSelfId(makeApi(getCurrent))).resolves.toBe('from-ready');
	expect(getCurrent).not.toHaveBeenCalled();
});

// A process that only ever RESUMEd sees no READY payload, which is the ordinary shape of a restart since the
// session store landed -- so there is nothing to have recorded and it has to ask.
test('falls back to a fetch when READY never arrived, then remembers it', async () => {
	const { getSelfId } = await freshModule();
	const getCurrent = vi.fn(async () => ({ id: 'fetched' }));
	const api = makeApi(getCurrent);

	await expect(getSelfId(api)).resolves.toBe('fetched');
	await expect(getSelfId(api)).resolves.toBe('fetched');
	expect(getCurrent).toHaveBeenCalledTimes(1);
});

test('does not remember a failed fetch', async () => {
	const { getSelfId } = await freshModule();
	const getCurrent = vi
		.fn<() => Promise<{ id: string }>>()
		.mockRejectedValueOnce(new Error('transient'))
		.mockResolvedValue({ id: 'fetched' });
	const api = makeApi(getCurrent);

	await expect(getSelfId(api)).rejects.toThrow('transient');
	await expect(getSelfId(api)).resolves.toBe('fetched');
});
