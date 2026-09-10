import { DiscordAPIError } from '@discordjs/rest';
import { afterEach, expect, test, vi } from 'vitest';

const { redis, db, getMemberBans } = vi.hoisted(() => ({
	redis: { exists: vi.fn(), set: vi.fn(), del: vi.fn() },
	db: vi.fn(),
	getMemberBans: vi.fn(),
}));

vi.mock('@chatsift/backend-core', () => ({ getContext: () => ({ redis, db }) }));
// Stubbed outright rather than imported behind a fake env: `discordAPI.ts` builds five `REST` clients off bot
// tokens at module scope, and none of that is what's under test here.
vi.mock('../discordAPI.js', () => ({ discordAPIAppeals: { guilds: { getMemberBans } } }));

const { probeGuildBan } = await import('../appealsBans.js');

const GUILD = '1425493115053019319';
const USER = '1425493115053019400';
const OTHER_USER = '1425493115053019500';

const warn = vi.fn();
const logger = { warn } as never;

function discordError(status: number): DiscordAPIError {
	return new DiscordAPIError(
		{ code: status === 404 ? 10_004 : 50_013, message: 'boom' },
		status,
		status,
		'GET',
		'',
		{},
	);
}

afterEach(() => {
	vi.clearAllMocks();
	redis.exists.mockReset();
	db.mockReset();
});

test('probes with limit 1 and the snowflake immediately below the user', async () => {
	redis.exists.mockResolvedValue(0);
	getMemberBans.mockResolvedValue([]);

	await probeGuildBan(GUILD, USER, logger);

	// The direction is the whole trick: bans come back ordered by user id ascending, so asking for the first
	// entry strictly *after* `userId - 1` is what makes `limit=1` land on this user's own ban when it exists.
	expect(getMemberBans).toHaveBeenCalledWith(GUILD, { after: '1425493115053019399', limit: 1 });
});

test('an entry for this user reads as banned, and carries the reason through', async () => {
	redis.exists.mockResolvedValue(0);
	getMemberBans.mockResolvedValue([{ user: { id: USER }, reason: 'ban evasion' }]);

	await expect(probeGuildBan(GUILD, USER, logger)).resolves.toStrictEqual({ banned: true, banReason: 'ban evasion' });
	expect(db).toHaveBeenCalledOnce();
});

test('a reasonless ban is still a ban', async () => {
	redis.exists.mockResolvedValue(0);
	getMemberBans.mockResolvedValue([{ user: { id: USER }, reason: null }]);

	await expect(probeGuildBan(GUILD, USER, logger)).resolves.toStrictEqual({ banned: true, banReason: null });
});

test('an empty page reads as not banned', async () => {
	redis.exists.mockResolvedValue(0);
	getMemberBans.mockResolvedValue([]);

	await expect(probeGuildBan(GUILD, USER, logger)).resolves.toStrictEqual({ banned: false, banReason: null });
});

// The `after` cursor returns the *next* ban above the user when the user themselves isn't banned, so the id
// check is load-bearing -- without it every appellant below any banned account would read as banned.
test("somebody else's ban coming back does not read as this user being banned", async () => {
	redis.exists.mockResolvedValue(0);
	getMemberBans.mockResolvedValue([{ user: { id: OTHER_USER }, reason: 'not about this user' }]);

	await expect(probeGuildBan(GUILD, USER, logger)).resolves.toStrictEqual({ banned: false, banReason: null });
});

test('a definite answer clears the block key and writes the check through', async () => {
	redis.exists.mockResolvedValue(0);
	getMemberBans.mockResolvedValue([]);

	await probeGuildBan(GUILD, USER, logger);

	expect(redis.del).toHaveBeenCalledWith(`appeals:probeblocked:${GUILD}`);
	expect(db).toHaveBeenCalledOnce();
});

test.each([403, 404])(
	'a %i blocks the guild for a while and answers "cannot tell", not "not banned"',
	async (status) => {
		redis.exists.mockResolvedValue(0);
		getMemberBans.mockRejectedValue(discordError(status));

		await expect(probeGuildBan(GUILD, USER, logger)).resolves.toBeNull();
		expect(redis.set).toHaveBeenCalledWith(`appeals:probeblocked:${GUILD}`, '1', expect.anything());
		// Nothing is written through: a guild we cannot read is not evidence about anybody's ban state.
		expect(db).not.toHaveBeenCalled();
	},
);

test('a blocked guild short-circuits before spending a request', async () => {
	redis.exists.mockResolvedValue(1);

	await expect(probeGuildBan(GUILD, USER, logger)).resolves.toBeNull();
	expect(getMemberBans).not.toHaveBeenCalled();
});

// A 5xx or a socket error says nothing about permissions, so writing the guild off over one would take
// Appeals down for that guild for five minutes on a transient blip.
test('any other failure propagates rather than being written off', async () => {
	redis.exists.mockResolvedValue(0);
	getMemberBans.mockRejectedValue(discordError(500));

	await expect(probeGuildBan(GUILD, USER, logger)).rejects.toThrow(DiscordAPIError);
	expect(redis.set).not.toHaveBeenCalled();
});
