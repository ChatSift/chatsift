import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@chatsift/backend-core';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stubBackendCoreEnv } from './testEnv.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const { fakeLogger, fakeReply } = vi.hoisted(() => ({
	fakeLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
	fakeReply: vi.fn(),
}));

vi.mock('@chatsift/backend-core', async (importActual) => {
	stubBackendCoreEnv();
	const actual = await importActual<typeof import('@chatsift/backend-core')>();

	return {
		...actual,
		getContext: () => ({
			logger: fakeLogger,
			service: {
				client: {
					api: {
						interactions: {
							reply: fakeReply,
						},
					},
				},
			},
		}),
	};
});

const {
	handleComponentInteraction,
	registerComponentHandler,
	registerComponentHandlers,
	registerUnknownComponentResolver,
} = await import('../components.js');
const { setGuildOwnershipFilter } = await import('../ownership.js');

const logger = fakeLogger as unknown as Logger;

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	// See commands.test.ts's matching afterEach -- there's no unregister API, so tests reset the
	// module-level filter back to "no foreign owner anywhere" themselves. Same for the unknown-component
	// resolver: a leftover one that claims everything would silence a later test's "no handler found".
	setGuildOwnershipFilter(() => null);
	registerUnknownComponentResolver(async () => false);
});

function makeInteraction(customId: string, guildId?: string): APIMessageComponentInteraction {
	return {
		id: 'interaction-1',
		token: 'tok',
		data: { custom_id: customId },
		guild_id: guildId,
	} as unknown as APIMessageComponentInteraction;
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

	test('falls through to the unknown-component resolver, and stays quiet when it claims the interaction', async () => {
		const resolver = vi.fn().mockResolvedValue(true);
		registerUnknownComponentResolver(resolver);

		const interaction = makeInteraction('roles-manage-simple|1234567890');
		await handleComponentInteraction(interaction, logger);

		expect(resolver).toHaveBeenCalledWith(interaction, logger);
		expect(fakeLogger.warn).not.toHaveBeenCalled();
	});

	test('still warns when the unknown-component resolver declines', async () => {
		registerUnknownComponentResolver(vi.fn().mockResolvedValue(false));

		await handleComponentInteraction(makeInteraction('unit-test-comp-still-unknown'), logger);

		expect(fakeLogger.warn).toHaveBeenCalled();
	});

	test('never consults the resolver when a registered handler matches', async () => {
		const resolver = vi.fn().mockResolvedValue(true);
		const handle = vi.fn();
		registerUnknownComponentResolver(resolver);
		registerComponentHandler({ name: 'unit-test-comp-not-shadowed', stateStore: null, handle } as any);

		await handleComponentInteraction(makeInteraction('unit-test-comp-not-shadowed:row-1'), logger);

		expect(handle).toHaveBeenCalled();
		expect(resolver).not.toHaveBeenCalled();
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
		// The module (and its `calls` array) is cached across the whole test run, not reset per-test -- clear it
		// so this assertion holds regardless of whether a prior run already dispatched to this fixture.
		calls.length = 0;

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

describe('guild ownership gating (#216)', () => {
	test('replies with the foreign owner label and never resolves state or dispatches to the handler', async () => {
		const handle = vi.fn();
		const get = vi.fn();
		registerComponentHandler({ name: 'unit-test-comp-foreign', stateStore: { get }, handle } as any);
		setGuildOwnershipFilter((guildId) => (guildId === 'foreign-guild' ? 'Some Partner ModMail' : null));

		const interaction = makeInteraction('unit-test-comp-foreign:row-1', 'foreign-guild');
		await handleComponentInteraction(interaction, logger);

		expect(get).not.toHaveBeenCalled();
		expect(handle).not.toHaveBeenCalled();
		expect(fakeReply).toHaveBeenCalledWith(
			interaction.id,
			interaction.token,
			expect.objectContaining({
				content: expect.stringContaining('Some Partner ModMail'),
				flags: MessageFlags.Ephemeral,
			}),
		);
		expect(fakeLogger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ guildId: 'foreign-guild', foreignOwnerLabel: 'Some Partner ModMail' }),
			expect.any(String),
		);
	});

	test('dispatches normally when this deployment owns the guild', async () => {
		const handle = vi.fn();
		registerComponentHandler({ name: 'unit-test-comp-owned', stateStore: null, handle } as any);
		setGuildOwnershipFilter((guildId) => (guildId === 'foreign-guild' ? 'Some Partner ModMail' : null));

		const interaction = makeInteraction('unit-test-comp-owned:row-1', 'owned-guild');
		await handleComponentInteraction(interaction, logger);

		expect(handle).toHaveBeenCalledWith(interaction, 'row-1', logger);
		expect(fakeReply).not.toHaveBeenCalled();
	});
});
