import type { Logger } from '@chatsift/backend-core';
import { PermissionFlagsBits } from '@discordjs/core';
import { afterEach, expect, test, vi } from 'vitest';

const { fakeGetContext, fakeGetSelfId } = vi.hoisted(() => ({
	fakeGetContext: vi.fn(),
	fakeGetSelfId: vi.fn(),
}));

// Only what `lib/botPermissions.ts` actually reaches for -- `computeChannelPermissions` is deliberately left
// real, since the whole point of this file is which permissions come out the far end of it.
vi.mock('@chatsift/backend-core', () => ({ getContext: fakeGetContext }));
vi.mock('@chatsift/bot-core', () => ({ getSelfId: fakeGetSelfId }));

const { findMissingPermissions, formatMissingPermissionsNotice, MOD_FORUM_PERMISSIONS, PANEL_CHANNEL_PERMISSIONS } =
	await import('../botPermissions.js');

const GUILD_ID = '1484034316357996658';
const OWNER_ID = '1084780104284110858';
const BOT_ID = '1234567890123456789';
const BOT_ROLE_ID = '2222222222222222222';
const MOD_FORUM_ID = '3333333333333333333';
const PANEL_CHANNEL_ID = '4444444444444444444';

const logger = { warn: vi.fn() } as unknown as Logger;

const EVERYTHING = [...MOD_FORUM_PERMISSIONS, ...PANEL_CHANNEL_PERMISSIONS].reduce(
	(permissions, requirement) => permissions | requirement.permission,
	0n,
);

function mockGuild(botRolePermissions: bigint, deniedByChannel: Record<string, bigint> = {}) {
	const guildGet = vi.fn(async () => ({
		owner_id: OWNER_ID,
		roles: [
			{ id: GUILD_ID, permissions: '0' },
			{ id: BOT_ROLE_ID, permissions: String(botRolePermissions) },
		],
	}));

	const getMember = vi.fn(async () => ({ roles: [BOT_ROLE_ID] }));

	const channelGet = vi.fn(async (channelId: string) => ({
		id: channelId,
		permission_overwrites: deniedByChannel[channelId]
			? [{ id: BOT_ROLE_ID, type: 0, allow: '0', deny: String(deniedByChannel[channelId]) }]
			: [],
	}));

	fakeGetSelfId.mockResolvedValue(BOT_ID);
	fakeGetContext.mockReturnValue({
		service: { client: { api: { guilds: { get: guildGet, getMember }, channels: { get: channelGet } } } },
	});

	return { channelGet, getMember, guildGet };
}

afterEach(() => {
	vi.clearAllMocks();
});

test('a channel with everything it needs is left out of the result entirely', async () => {
	mockGuild(EVERYTHING);

	await expect(
		findMissingPermissions(
			GUILD_ID,
			[
				{ channelId: MOD_FORUM_ID, requirements: MOD_FORUM_PERMISSIONS },
				{ channelId: PANEL_CHANNEL_ID, requirements: PANEL_CHANNEL_PERMISSIONS },
			],
			logger,
		),
	).resolves.toStrictEqual([]);
});

test('a per-channel overwrite is what decides it, so only the channel that denies shows up', async () => {
	// The exact shape #370's notice couldn't see: the mod forum is fine, and the panel channel the private
	// thread hangs off denies `ManageThreads`, which is only ever needed once the ticket closes.
	mockGuild(EVERYTHING, { [PANEL_CHANNEL_ID]: PermissionFlagsBits.ManageThreads });

	const results = await findMissingPermissions(
		GUILD_ID,
		[
			{ channelId: MOD_FORUM_ID, requirements: MOD_FORUM_PERMISSIONS },
			{ channelId: PANEL_CHANNEL_ID, requirements: PANEL_CHANNEL_PERMISSIONS },
		],
		logger,
	);

	expect(results).toHaveLength(1);
	expect(results![0]!.channelId).toBe(PANEL_CHANNEL_ID);
	expect(results![0]!.missing.map((requirement) => requirement.permission)).toStrictEqual([
		PermissionFlagsBits.ManageThreads,
	]);
});

test('the guild and the bot member are fetched once no matter how many channels are checked', async () => {
	const { channelGet, getMember, guildGet } = mockGuild(EVERYTHING);

	await findMissingPermissions(
		GUILD_ID,
		[
			{ channelId: MOD_FORUM_ID, requirements: MOD_FORUM_PERMISSIONS },
			{ channelId: PANEL_CHANNEL_ID, requirements: PANEL_CHANNEL_PERMISSIONS },
		],
		logger,
	);

	expect(guildGet).toHaveBeenCalledTimes(1);
	expect(getMember).toHaveBeenCalledTimes(1);
	expect(channelGet).toHaveBeenCalledTimes(2);
});

test('a failed lookup is null, never an empty "nothing is missing"', async () => {
	mockGuild(EVERYTHING);
	fakeGetSelfId.mockRejectedValue(new Error('no'));

	await expect(
		findMissingPermissions(GUILD_ID, [{ channelId: MOD_FORUM_ID, requirements: MOD_FORUM_PERMISSIONS }], logger),
	).resolves.toBeNull();
});

test('the notice names every channel and permission it was given', () => {
	const notice = formatMissingPermissionsNotice([
		{
			channelId: PANEL_CHANNEL_ID,
			missing: [{ permission: PermissionFlagsBits.ManageThreads, breaks: 'deleting it later' }],
		},
		{
			channelId: MOD_FORUM_ID,
			missing: [{ permission: PermissionFlagsBits.AttachFiles, breaks: 'files sent by the user' }],
		},
	]);

	expect(notice).toBe(
		[
			`-# ⚠️ ModMail is missing permissions in <#${PANEL_CHANNEL_ID}>, so parts of this ticket won't work:`,
			'-# • **Manage Threads** — deleting it later',
			`-# ⚠️ ModMail is missing permissions in <#${MOD_FORUM_ID}>, so parts of this ticket won't work:`,
			'-# • **Attach Files** — files sent by the user',
		].join('\n'),
	);
});
