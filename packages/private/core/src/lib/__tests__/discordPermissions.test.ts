import { OverwriteType, PermissionFlagsBits } from 'discord-api-types/v10';
import { expect, test } from 'vitest';
import type { ComputeChannelPermissionsOptions } from '../discordPermissions.js';
import { computeChannelPermissions, permissionNames, PermissionsBitField } from '../discordPermissions.js';

const GUILD_ID = '1194016111730098186';
const OWNER_ID = '1084780104284110858';
const BOT_ID = '1234567890123456789';
const BOT_ROLE_ID = '2222222222222222222';
const OTHER_ROLE_ID = '3333333333333333333';

const SEND = PermissionFlagsBits.SendMessages;
const VIEW = PermissionFlagsBits.ViewChannel;

function compute(overrides: Partial<ComputeChannelPermissionsOptions> = {}): bigint {
	return computeChannelPermissions({
		guildId: GUILD_ID,
		guildOwnerId: OWNER_ID,
		memberId: BOT_ID,
		memberRoleIds: [BOT_ROLE_ID],
		overwrites: [],
		roles: [
			{ id: GUILD_ID, permissions: String(VIEW) },
			{ id: BOT_ROLE_ID, permissions: String(SEND) },
			{ id: OTHER_ROLE_ID, permissions: '0' },
		],
		...overrides,
	});
}

test('base permissions union @everyone with the member roles', () => {
	expect(compute()).toBe(VIEW | SEND);
});

/**
 * The shape of the production failure this exists to catch: the bot's roles carry Send Messages guild-wide,
 * but the (private) channel it was pointed at never granted it View Channel, so every post there 403s.
 */
test('an @everyone overwrite denying view survives a guild-wide grant', () => {
	const permissions = compute({
		overwrites: [{ id: GUILD_ID, type: OverwriteType.Role, allow: '0', deny: String(VIEW) }],
	});

	expect(PermissionsBitField.has(permissions, VIEW)).toBe(false);
	expect(PermissionsBitField.has(permissions, SEND)).toBe(true);
});

test('an allow on one role beats a deny on another, regardless of overwrite order', () => {
	const overwrites = [
		{ id: BOT_ROLE_ID, type: OverwriteType.Role, allow: String(VIEW), deny: '0' },
		{ id: OTHER_ROLE_ID, type: OverwriteType.Role, allow: '0', deny: String(VIEW) },
	];

	const options = { memberRoleIds: [BOT_ROLE_ID, OTHER_ROLE_ID], overwrites };
	expect(PermissionsBitField.has(compute(options), VIEW)).toBe(true);
	expect(PermissionsBitField.has(compute({ ...options, overwrites: [...overwrites].reverse() }), VIEW)).toBe(true);
});

test('a member overwrite is applied after the role ones', () => {
	const permissions = compute({
		overwrites: [
			{ id: BOT_ROLE_ID, type: OverwriteType.Role, allow: String(VIEW), deny: '0' },
			{ id: BOT_ID, type: OverwriteType.Member, allow: '0', deny: String(VIEW) },
		],
	});

	expect(PermissionsBitField.has(permissions, VIEW)).toBe(false);
});

test('administrator and ownership both bypass overwrites', () => {
	const denyEverything = [{ id: GUILD_ID, type: OverwriteType.Role, allow: '0', deny: String(VIEW | SEND) }];

	expect(
		compute({
			overwrites: denyEverything,
			roles: [
				{ id: GUILD_ID, permissions: '0' },
				{ id: BOT_ROLE_ID, permissions: String(PermissionFlagsBits.Administrator) },
			],
		}),
	).toBe(PermissionsBitField.mask);

	expect(compute({ memberId: OWNER_ID, overwrites: denyEverything })).toBe(PermissionsBitField.mask);
});

test('permission names read the way Discord labels them', () => {
	expect(permissionNames(VIEW | SEND | PermissionFlagsBits.SendMessagesInThreads)).toStrictEqual([
		'View Channel',
		'Send Messages',
		'Send Messages In Threads',
	]);
});
