import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@chatsift/backend-core';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { stubBackendCoreEnv } from './testEnv.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const { fakeLogger } = vi.hoisted(() => ({
	fakeLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@chatsift/backend-core', async (importActual) => {
	stubBackendCoreEnv();
	const actual = await importActual<typeof import('@chatsift/backend-core')>();

	return {
		...actual,
		getContext: () => ({ logger: fakeLogger }),
	};
});

const { handleComponentInteraction, registerComponentHandler, registerComponentHandlers } =
	await import('../components.js');

const logger = fakeLogger as unknown as Logger;

beforeEach(() => {
	vi.clearAllMocks();
});

function makeInteraction(customId: string): APIMessageComponentInteraction {
	return { data: { custom_id: customId } } as unknown as APIMessageComponentInteraction;
}

describe('handleComponentInteraction', () => {
	test('with stateStore: null, the raw stateId off the custom_id is passed straight through', async () => {
		const handle = vi.fn();
		registerComponentHandler({ name: 'unit-test-comp-raw-state', stateStore: null, handle } as any);

		const interaction = makeInteraction('unit-test-comp-raw-state:row-42');
		await handleComponentInteraction(interaction, logger);

		expect(handle).toHaveBeenCalledWith(interaction, 'row-42', logger);
	});

	test('with a stateStore, stateId is resolved through store.get() before being passed to handle', async () => {
		const handle = vi.fn();
		const resolvedState = { some: 'value' };
		const get = vi.fn().mockResolvedValue(resolvedState);
		registerComponentHandler({ name: 'unit-test-comp-redis-state', stateStore: { get }, handle } as any);

		const interaction = makeInteraction('unit-test-comp-redis-state:abc123');
		await handleComponentInteraction(interaction, logger);

		expect(get).toHaveBeenCalledWith('abc123');
		expect(handle).toHaveBeenCalledWith(interaction, resolvedState, logger);
	});

	test('with no stateId and stateStore: null, handle is called with undefined state', async () => {
		const handle = vi.fn();
		registerComponentHandler({ name: 'unit-test-comp-no-state', stateStore: null, handle } as any);

		const interaction = makeInteraction('unit-test-comp-no-state');
		await handleComponentInteraction(interaction, logger);

		expect(handle).toHaveBeenCalledWith(interaction, undefined, logger);
	});

	test('warns and does not throw when no handler matches the componentName', async () => {
		const interaction = makeInteraction('unit-test-comp-does-not-exist:1');

		await expect(handleComponentInteraction(interaction, logger)).resolves.toBeUndefined();
		expect(fakeLogger.warn).toHaveBeenCalled();
	});

	test('warns and does not call handle when a stateStore is required but stateId is missing', async () => {
		const handle = vi.fn();
		const get = vi.fn();
		registerComponentHandler({ name: 'unit-test-comp-missing-state', stateStore: { get }, handle } as any);

		const interaction = makeInteraction('unit-test-comp-missing-state');
		await handleComponentInteraction(interaction, logger);

		expect(handle).not.toHaveBeenCalled();
		expect(get).not.toHaveBeenCalled();
		expect(fakeLogger.warn).toHaveBeenCalled();
	});
});

describe('registerComponentHandlers', () => {
	test('discovers, imports, and registers a valid default-exported handler, and skips an invalid module', async () => {
		await registerComponentHandlers(fixturesDir);

		const { calls } = await import('./fixtures/validComponent.js');

		const interaction = makeInteraction('fixture-valid-component:some-state');
		await handleComponentInteraction(interaction, logger);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ interaction, logger, state: 'some-state' });

		expect(fakeLogger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ file: expect.stringContaining('invalidComponent.js') }),
			'Skipped invalid component handler module',
		);
	});
});
