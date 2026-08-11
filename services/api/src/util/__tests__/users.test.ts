import type { APIUser } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { afterEach, expect, test, vi } from 'vitest';

const { fakeFetchUserCached } = vi.hoisted(() => ({ fakeFetchUserCached: vi.fn() }));

// Only the one export `users.ts` actually uses. Stubbing the module outright (rather than importing the
// real one behind `stubTestEnv`) keeps redis entirely out of this file -- what's under test here is the
// 404-to-null mapping the caller is contractually required to supply, not the cache itself.
vi.mock('@chatsift/backend-core', () => ({ fetchUserCached: fakeFetchUserCached }));

const { resolveDiscordUser, resolveDiscordUserOrNull } = await import('../users.js');

const USER_ID = '1425493115053019319';

function discordError(status: number): DiscordAPIError {
	return new DiscordAPIError(
		{ code: status === 404 ? 10_013 : 50_001, message: 'boom' },
		status,
		status,
		'GET',
		'',
		{},
	);
}

function apiThatThrows(error: unknown) {
	return { users: { get: vi.fn().mockRejectedValue(error) } } as never;
}

// The cache is a pass-through here: every assertion below is about the callback `users.ts` hands it.
function runFetcher() {
	return fakeFetchUserCached.mock.calls[0]![1](USER_ID);
}

afterEach(() => {
	vi.clearAllMocks();
});

test('a resolved user is returned as-is', async () => {
	const user = { id: USER_ID, username: 'didinele' } as APIUser;
	fakeFetchUserCached.mockResolvedValue(user);

	await expect(resolveDiscordUserOrNull({ users: { get: vi.fn() } } as never, USER_ID)).resolves.toBe(user);
	expect(fakeFetchUserCached).toHaveBeenCalledWith(USER_ID, expect.any(Function));
});

// `fetchUserCached`'s contract: the caller's fetcher must map a 404 to `null` (deleted account, or never a
// real user) so the cache can store that as a negative entry rather than retrying forever.
test('a 404 from Discord maps to null rather than throwing', async () => {
	fakeFetchUserCached.mockResolvedValue(null);

	await expect(resolveDiscordUserOrNull(apiThatThrows(discordError(404)), USER_ID)).resolves.toBeNull();
	await expect(runFetcher()).resolves.toBeNull();
});

// A rate limit, a 5xx or a dead token says nothing about whether the user exists -- swallowing those would
// poison the cache with a bogus negative entry.
test('any other Discord error still propagates', async () => {
	fakeFetchUserCached.mockImplementation(async (_id: string, fetchUser: (id: string) => Promise<unknown>) =>
		fetchUser(_id),
	);

	await expect(resolveDiscordUserOrNull(apiThatThrows(discordError(403)), USER_ID)).rejects.toBeInstanceOf(
		DiscordAPIError,
	);
	await expect(resolveDiscordUserOrNull(apiThatThrows(new Error('socket hang up')), USER_ID)).rejects.toThrow(
		'socket hang up',
	);
});

// A user Discord can't resolve is still worth rendering as a bare id rather than failing the whole request.
test('resolveDiscordUser falls back to the raw snowflake', async () => {
	fakeFetchUserCached.mockResolvedValue(null);
	await expect(resolveDiscordUser({ users: { get: vi.fn() } } as never, USER_ID)).resolves.toBe(USER_ID);

	const user = { id: USER_ID, username: 'didinele' } as APIUser;
	fakeFetchUserCached.mockResolvedValue(user);
	await expect(resolveDiscordUser({ users: { get: vi.fn() } } as never, USER_ID)).resolves.toBe(user);
});
