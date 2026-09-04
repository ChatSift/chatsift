import { PermissionFlagsBits } from '@discordjs/core';
import { beforeEach, expect, test, vi } from 'vitest';

const GUILD_ID = '1425493115053019310';
const OWNER_ID = '110000000000000001';
const MEMBER_ID = '110000000000000002';

let guild: { owner_id: string; roles: { id: string; permissions: string }[] } | null = null;
let guildCalls = 0;

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({
		logger: { warn() {} },
		service: {
			client: {
				api: {
					guilds: {
						async get() {
							guildCalls += 1;
							if (!guild) {
								throw new Error('nope');
							}

							return guild;
						},
					},
				},
			},
		},
	}),
}));

const { clearFilterImmunityCache, findFilterImmunity } = await import('../filterImmunity.js');

// `@everyone` is the role whose id is the guild id, and it applies to everybody -- so it has to be in every
// fixture or the permissions computed here would not be the ones Discord computes.
function withRoles(...roles: { id: string; permissions: bigint }[]) {
	guild = {
		owner_id: OWNER_ID,
		roles: [
			{ id: GUILD_ID, permissions: String(PermissionFlagsBits.SendMessages) },
			...roles.map((role) => ({ id: role.id, permissions: String(role.permissions) })),
		],
	};
}

beforeEach(() => {
	clearFilterImmunityCache();
	guildCalls = 0;
	withRoles();
});

test('the guild owner is immune, whatever roles they hold', async () => {
	expect(await findFilterImmunity(GUILD_ID, OWNER_ID, [])).toBe('OWNER');
});

test('an ordinary member is not immune', async () => {
	withRoles({ id: 'members', permissions: PermissionFlagsBits.AddReactions });

	expect(await findFilterImmunity(GUILD_ID, MEMBER_ID, ['members'])).toBeNull();
});

test('Administrator and Manage Messages are reported apart', async () => {
	withRoles(
		{ id: 'admins', permissions: PermissionFlagsBits.Administrator },
		{ id: 'mods', permissions: PermissionFlagsBits.ManageMessages },
	);

	// Administrator implies everything, so the order of the two checks is what decides which of them the log
	// names -- and "an administrator" is the more useful sentence.
	expect(await findFilterImmunity(GUILD_ID, MEMBER_ID, ['admins'])).toBe('ADMINISTRATOR');
	expect(await findFilterImmunity(GUILD_ID, MEMBER_ID, ['mods'])).toBe('MANAGE_MESSAGES');
});

// A role the member does not hold must not count, which is the whole point of computing rather than scanning.
test('a permission on a role the member lacks does not make them immune', async () => {
	withRoles({ id: 'mods', permissions: PermissionFlagsBits.ManageMessages });

	expect(await findFilterImmunity(GUILD_ID, MEMBER_ID, ['members'])).toBeNull();
});

// A guild that hands Manage Messages to `@everyone` has said everyone can delete messages; taking it at its
// word is the honest reading, however unusual.
test('@everyone counts', async () => {
	guild = {
		owner_id: OWNER_ID,
		roles: [{ id: GUILD_ID, permissions: String(PermissionFlagsBits.ManageMessages) }],
	};

	expect(await findFilterImmunity(GUILD_ID, MEMBER_ID, [])).toBe('MANAGE_MESSAGES');
});

// One read per guild, not one per message: this runs on the hot path.
test('the guild is read once and then cached', async () => {
	await findFilterImmunity(GUILD_ID, MEMBER_ID, []);
	await findFilterImmunity(GUILD_ID, MEMBER_ID, []);

	expect(guildCalls).toBe(1);
});

// Fails open, matching the bypass check: a guild we cannot read must not silently exempt everybody. The
// failure is still cached, or an unreadable guild would issue one request per message forever.
test('a guild that cannot be read exempts nobody, and is not re-read immediately', async () => {
	guild = null;

	expect(await findFilterImmunity(GUILD_ID, OWNER_ID, [])).toBeNull();
	expect(await findFilterImmunity(GUILD_ID, OWNER_ID, [])).toBeNull();
	expect(guildCalls).toBe(1);
});
