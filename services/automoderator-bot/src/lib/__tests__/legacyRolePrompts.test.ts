import type { Logger } from '@chatsift/backend-core';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { beforeEach, expect, test, vi } from 'vitest';

const reply = vi.fn();

// `backend-core` parses its env schema at import time, which throws in a unit test -- same stub shape as
// `reportDraftFlow.test.ts`.
vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({ service: { client: { api: { interactions: { reply } } } } }),
	RedisStore: class {},
}));

const { isLegacyRolePromptCustomId, resolveLegacyRolePrompt } = await import('../legacyRolePrompts.js');

const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Logger;

function interaction(customId: string): APIMessageComponentInteraction {
	return {
		id: 'interaction-1',
		token: 'tok',
		guild_id: '1',
		data: { custom_id: customId },
	} as unknown as APIMessageComponentInteraction;
}

beforeEach(() => {
	vi.clearAllMocks();
});

test.each([
	['roles-manage-prompt', true],
	['roles-manage-simple|1234567890', true],
	['roles-manage|7|0', true],
	// Ours, and the reason the resolver only ever runs after the handler map misses.
	['report-dismiss:42', false],
	// Prefix-only overlap: the legacy ids are matched on the whole first `|` segment, not a `startsWith`.
	['roles-manage-simple-not-really', false],
	['roles-management', false],
])('%s is recognised as a legacy prompt id: %s', (customId, expected) => {
	expect(isLegacyRolePromptCustomId(customId)).toBe(expected);
});

test('answers a legacy prompt click ephemerally and points at Discord onboarding', async () => {
	const handled = await resolveLegacyRolePrompt(interaction('roles-manage-simple|1234567890'), logger);

	expect(handled).toBe(true);
	expect(reply).toHaveBeenCalledWith(
		'interaction-1',
		'tok',
		expect.objectContaining({
			content: expect.stringContaining('Onboarding'),
			flags: MessageFlags.Ephemeral,
		}),
	);
});

test('declines an unrelated custom_id without replying', async () => {
	const handled = await resolveLegacyRolePrompt(interaction('report-dismiss:42'), logger);

	expect(handled).toBe(false);
	expect(reply).not.toHaveBeenCalled();
});

test('still claims the interaction when the reply fails, so it is not logged as an unknown component', async () => {
	reply.mockRejectedValueOnce(new Error('Unknown interaction'));

	const handled = await resolveLegacyRolePrompt(interaction('roles-manage-prompt'), logger);

	expect(handled).toBe(true);
	expect(logger.error).toHaveBeenCalled();
});
