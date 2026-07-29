import type { Logger } from '@chatsift/backend-core';
import type { APIApplicationCommandAutocompleteInteraction, APIApplicationCommandInteraction } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stubBackendCoreEnv } from './testEnv.js';

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
	getAllCommandsData,
	getCommandHandler,
	handleAutocompleteInteraction,
	handleCommandInteraction,
	registerCommandHandler,
} = await import('../commands.js');
const { setGuildOwnershipFilter } = await import('../ownership.js');

const logger = fakeLogger as unknown as Logger;

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	// Reset to "no foreign owner anywhere" so a filter registered inside one test can't leak into the
	// next -- there's no unregister API, since real callers only ever set this once at boot.
	setGuildOwnershipFilter(() => null);
});

function makeCommandInteraction(name: string, guildId?: string): APIApplicationCommandInteraction {
	return {
		id: 'interaction-1',
		token: 'tok',
		data: { name },
		guild_id: guildId,
	} as unknown as APIApplicationCommandInteraction;
}

function makeAutocompleteInteraction(name: string, guildId?: string): APIApplicationCommandAutocompleteInteraction {
	return {
		id: 'interaction-1',
		token: 'tok',
		data: { name },
		guild_id: guildId,
	} as unknown as APIApplicationCommandAutocompleteInteraction;
}

describe('registerCommandHandler / getCommandHandler / getAllCommandsData', () => {
	test('a registered handler becomes retrievable by name and appears in the full data list', () => {
		const handler = { name: 'unit-test-cmd-registry', data: { name: 'unit-test-cmd-registry' }, handle: vi.fn() };
		registerCommandHandler(handler as any);

		expect(getCommandHandler('unit-test-cmd-registry')).toBe(handler);
		expect(getAllCommandsData()).toContainEqual(handler.data);
	});

	test('registering a second handler under the same name overwrites the first', () => {
		const first = { name: 'unit-test-cmd-overwrite', data: { name: 'unit-test-cmd-overwrite', v: 1 }, handle: vi.fn() };
		const second = {
			name: 'unit-test-cmd-overwrite',
			data: { name: 'unit-test-cmd-overwrite', v: 2 },
			handle: vi.fn(),
		};
		registerCommandHandler(first as any);
		registerCommandHandler(second as any);

		expect(getCommandHandler('unit-test-cmd-overwrite')).toBe(second);
	});
});

describe('handleCommandInteraction', () => {
	test('dispatches to the handle() of the matching registered handler', async () => {
		const handle = vi.fn();
		registerCommandHandler({ name: 'unit-test-cmd-dispatch', data: { name: 'unit-test-cmd-dispatch' }, handle } as any);

		const interaction = makeCommandInteraction('unit-test-cmd-dispatch');
		await handleCommandInteraction(interaction, logger);

		expect(handle).toHaveBeenCalledWith(interaction, logger);
		expect(fakeReply).not.toHaveBeenCalled();
	});

	test('replies with an ephemeral error and does not throw when no handler is registered', async () => {
		const interaction = makeCommandInteraction('unit-test-cmd-does-not-exist');

		await expect(handleCommandInteraction(interaction, logger)).resolves.toBeUndefined();

		expect(fakeReply).toHaveBeenCalledWith(
			interaction.id,
			interaction.token,
			expect.objectContaining({ content: expect.any(String), flags: MessageFlags.Ephemeral }),
		);
		expect(fakeLogger.warn).toHaveBeenCalled();
	});
});

describe('handleAutocompleteInteraction', () => {
	test('dispatches to handleAutocomplete() when the handler defines one', async () => {
		const handleAutocomplete = vi.fn();
		registerCommandHandler({
			name: 'unit-test-cmd-autocomplete',
			data: { name: 'unit-test-cmd-autocomplete' },
			handle: vi.fn(),
			handleAutocomplete,
		} as any);

		const interaction = makeAutocompleteInteraction('unit-test-cmd-autocomplete');
		await handleAutocompleteInteraction(interaction, logger);

		expect(handleAutocomplete).toHaveBeenCalledWith(interaction, logger);
	});

	test('warns and does not throw when the matching handler has no handleAutocomplete', async () => {
		registerCommandHandler({
			name: 'unit-test-cmd-no-autocomplete',
			data: { name: 'unit-test-cmd-no-autocomplete' },
			handle: vi.fn(),
		} as any);

		const interaction = makeAutocompleteInteraction('unit-test-cmd-no-autocomplete');

		await expect(handleAutocompleteInteraction(interaction, logger)).resolves.toBeUndefined();
		expect(fakeLogger.warn).toHaveBeenCalled();
	});

	test('warns and does not throw when no handler is registered at all', async () => {
		const interaction = makeAutocompleteInteraction('unit-test-cmd-autocomplete-missing');

		await expect(handleAutocompleteInteraction(interaction, logger)).resolves.toBeUndefined();
		expect(fakeLogger.warn).toHaveBeenCalled();
	});
});

describe('guild ownership gating (#216)', () => {
	test('handleCommandInteraction replies with the foreign owner label and never dispatches to the handler', async () => {
		const handle = vi.fn();
		registerCommandHandler({ name: 'unit-test-cmd-foreign', data: { name: 'unit-test-cmd-foreign' }, handle } as any);
		setGuildOwnershipFilter((guildId) => (guildId === 'foreign-guild' ? 'Some Partner ModMail' : null));

		const interaction = makeCommandInteraction('unit-test-cmd-foreign', 'foreign-guild');
		await handleCommandInteraction(interaction, logger);

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

	test('handleCommandInteraction dispatches normally when this deployment owns the guild', async () => {
		const handle = vi.fn();
		registerCommandHandler({ name: 'unit-test-cmd-owned', data: { name: 'unit-test-cmd-owned' }, handle } as any);
		setGuildOwnershipFilter((guildId) => (guildId === 'foreign-guild' ? 'Some Partner ModMail' : null));

		const interaction = makeCommandInteraction('unit-test-cmd-owned', 'owned-guild');
		await handleCommandInteraction(interaction, logger);

		expect(handle).toHaveBeenCalledWith(interaction, logger);
		expect(fakeReply).not.toHaveBeenCalled();
	});

	test('handleAutocompleteInteraction silently skips a foreign-owned guild instead of running the query', async () => {
		const handleAutocomplete = vi.fn();
		registerCommandHandler({
			name: 'unit-test-cmd-autocomplete-foreign',
			data: { name: 'unit-test-cmd-autocomplete-foreign' },
			handle: vi.fn(),
			handleAutocomplete,
		} as any);
		setGuildOwnershipFilter((guildId) => (guildId === 'foreign-guild' ? 'Some Partner ModMail' : null));

		const interaction = makeAutocompleteInteraction('unit-test-cmd-autocomplete-foreign', 'foreign-guild');
		await handleAutocompleteInteraction(interaction, logger);

		expect(handleAutocomplete).not.toHaveBeenCalled();
		expect(fakeLogger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ guildId: 'foreign-guild', foreignOwnerLabel: 'Some Partner ModMail' }),
			expect.any(String),
		);
	});
});
