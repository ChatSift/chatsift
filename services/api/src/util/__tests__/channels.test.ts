import { afterEach, expect, test, vi } from 'vitest';

const { fakeFetch } = vi.hoisted(() => ({ fakeFetch: vi.fn() }));

// `channels.ts` builds its fetcher at module scope via `createCachedGuildFetcher`, which reaches redis and
// the Discord REST clients. Replacing the factory (rather than spying on the exported `fetchGuildChannels`,
// which wouldn't intercept the module-internal call site) hands the whole cache layer over to the test.
vi.mock('../guildDataCache.js', () => ({ createCachedGuildFetcher: () => ({ fetch: fakeFetch }) }));

const { assertChannelsBelongToGuild, fetchGuildChannels } = await import('../channels.js');

const GUILD = '1425493115053019319';
const CHANNEL = '1425493115053019320';
const OTHER_CHANNEL = '1425493115053019321';
const FOREIGN_CHANNEL = '1425493115053019322';

const warn = vi.fn();
const logger = { warn } as never;

afterEach(() => {
	vi.clearAllMocks();
});

test('fetchGuildChannels passes the guild, bot and force flag straight through', async () => {
	fakeFetch.mockResolvedValue([{ id: CHANNEL }]);

	await expect(fetchGuildChannels(GUILD, 'AMA')).resolves.toStrictEqual([{ id: CHANNEL }]);
	expect(fakeFetch).toHaveBeenCalledWith(GUILD, 'AMA', false);

	await fetchGuildChannels(GUILD, 'MODMAIL', true);
	expect(fakeFetch).toHaveBeenLastCalledWith(GUILD, 'MODMAIL', true);
});

test('an empty or all-null id list never touches the cache at all', async () => {
	await expect(assertChannelsBelongToGuild(GUILD, [], 'AMA', logger)).resolves.toBeUndefined();
	await expect(assertChannelsBelongToGuild(GUILD, [null, undefined], 'AMA', logger)).resolves.toBeUndefined();

	expect(fakeFetch).not.toHaveBeenCalled();
});

test('channels that all belong to the guild pass', async () => {
	fakeFetch.mockResolvedValue([{ id: CHANNEL }, { id: OTHER_CHANNEL }]);

	await expect(assertChannelsBelongToGuild(GUILD, [CHANNEL, OTHER_CHANNEL], 'AMA', logger)).resolves.toBeUndefined();
});

// A bot's REST client is shared across every guild it's installed in, so without this check nothing stops a
// guild manager pointing an AMA channel field at a channel in some *other* guild they know the id of.
test('a channel from another guild is rejected as a bad request naming it', async () => {
	fakeFetch.mockResolvedValue([{ id: CHANNEL }]);

	await expect(assertChannelsBelongToGuild(GUILD, [CHANNEL, FOREIGN_CHANNEL], 'AMA', logger)).rejects.toMatchObject({
		output: { statusCode: 400 },
		message: `channel ${FOREIGN_CHANNEL} does not belong to this guild`,
	});
});

// Nulls mixed in with real ids are the normal case (every AMA channel field is individually clearable) --
// they're filtered out rather than checked against the guild.
test('nulls alongside real ids are ignored, not validated', async () => {
	fakeFetch.mockResolvedValue([{ id: CHANNEL }]);

	await expect(assertChannelsBelongToGuild(GUILD, [null, CHANNEL, undefined], 'AMA', logger)).resolves.toBeUndefined();
});

// "We couldn't check" is not "the channel is fine" -- a failed lookup has to 500 rather than let the write through.
test('an unfetchable guild fails closed with a 500', async () => {
	fakeFetch.mockResolvedValue(null);

	await expect(assertChannelsBelongToGuild(GUILD, [CHANNEL], 'AMA', logger)).rejects.toMatchObject({
		output: { statusCode: 500 },
	});
	expect(warn).toHaveBeenCalledOnce();
});
