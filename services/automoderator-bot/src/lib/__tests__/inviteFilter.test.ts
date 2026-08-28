import { beforeEach, expect, test, vi } from 'vitest';

let allowRows: { allowedGuildId: string }[] = [];
let resolutions = new Map<string, Error | { guild?: { id: string } }>();
let inviteCalls: string[] = [];

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({
		async db() {
			return allowRows;
		},
		logger: { debug() {} },
		service: {
			client: {
				api: {
					invites: {
						async get(code: string) {
							inviteCalls.push(code);
							const resolution = resolutions.get(code);

							if (resolution instanceof Error) {
								throw resolution;
							}

							return resolution ?? {};
						},
					},
				},
			},
		},
	}),
}));

const { runInviteFilter, clearInviteCache } = await import('../inviteFilter.js');

beforeEach(() => {
	allowRows = [];
	resolutions = new Map();
	inviteCalls = [];
	clearInviteCache();
});

test('a message with no invites never reaches the database', async () => {
	expect(await runInviteFilter('home', 'just talking about discord')).toBeNull();
	expect(inviteCalls).toHaveLength(0);
});

test('an invite to an unallowed server is forbidden', async () => {
	resolutions.set('abc', { guild: { id: 'other' } });

	expect(await runInviteFilter('home', 'join discord.gg/abc')).toEqual({ forbidden: ['abc'] });
});

test('an invite to an allowlisted server is let through', async () => {
	allowRows = [{ allowedGuildId: 'partner' }];
	resolutions.set('abc', { guild: { id: 'partner' } });

	expect(await runInviteFilter('home', 'join discord.gg/abc')).toBeNull();
});

// The 2021 fix, kept: the allowlist names servers, so *every* code pointing at an allowed server is allowed,
// including a vanity URL and codes minted after the entry was added.
test('a second code to the same allowed server is also let through', async () => {
	allowRows = [{ allowedGuildId: 'partner' }];
	resolutions.set('vanity', { guild: { id: 'partner' } });

	expect(await runInviteFilter('home', 'discord.gg/vanity')).toBeNull();
});

// Legacy made every server allowlist itself, which none of them expected to have to do.
test("a guild's own invites are always allowed without a row", async () => {
	resolutions.set('ours', { guild: { id: 'home' } });

	expect(await runInviteFilter('home', 'discord.gg/ours')).toBeNull();
});

// Failing open is deliberate: a Discord outage must not delete every message containing an invite.
test('an unresolvable code is not deleted', async () => {
	resolutions.set('dead', new Error('404'));

	expect(await runInviteFilter('home', 'discord.gg/dead')).toBeNull();
});

test('a group-DM invite carries no guild and is left alone', async () => {
	resolutions.set('group', {});

	expect(await runInviteFilter('home', 'discord.gg/group')).toBeNull();
});

test('only the forbidden codes are reported, in order', async () => {
	allowRows = [{ allowedGuildId: 'partner' }];
	resolutions.set('ok', { guild: { id: 'partner' } });
	resolutions.set('bad1', { guild: { id: 'other' } });
	resolutions.set('bad2', { guild: { id: 'another' } });

	expect(await runInviteFilter('home', 'discord.gg/bad1 discord.gg/ok discord.gg/bad2')).toEqual({
		forbidden: ['bad1', 'bad2'],
	});
});

// A raid pastes the same link over and over; resolving it once per message is the cost this cache exists to
// avoid. A dead code is cached too, or the same raid costs one request per message forever to be told no.
test('a repeated code resolves once', async () => {
	resolutions.set('abc', { guild: { id: 'other' } });

	await runInviteFilter('home', 'discord.gg/abc');
	await runInviteFilter('home', 'discord.gg/abc');

	expect(inviteCalls).toEqual(['abc']);
});

test('a code that resolved to nothing is cached too', async () => {
	resolutions.set('dead', new Error('404'));

	await runInviteFilter('home', 'discord.gg/dead');
	await runInviteFilter('home', 'discord.gg/dead');

	expect(inviteCalls).toEqual(['dead']);
});
