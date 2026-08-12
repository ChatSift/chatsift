import { Buffer } from 'node:buffer';
import { beforeEach, expect, test, vi } from 'vitest';

const { redis } = vi.hoisted(() => ({
	redis: {
		pTTL: vi.fn(),
		zAdd: vi.fn(),
		expire: vi.fn(),
		zRemRangeByScore: vi.fn(),
		zRangeByScore: vi.fn(),
		set: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock('@chatsift/backend-core', () => ({ getContext: () => ({ redis }) }));

const { isEligibleForXp } = await import('../eligibility.js');

const GUILD = '1425493115053019319';
const USER = '223703707118731264';

const TRACKING_KEY = `leveling_tracking:${GUILD}:${USER}`;
const INELIGIBLE_KEY = `leveling_ineligible:${GUILD}:${USER}`;

/**
 * Snowflake for a given epoch-ms timestamp, so a test can control how much of the rolling window the oldest
 * tracked message has already consumed.
 */
function snowflakeAt(timestampMs: number): string {
	return String((BigInt(timestampMs) - 1_420_070_400_000n) << 22n);
}

function options(overrides: Partial<Parameters<typeof isEligibleForXp>[0]> = {}) {
	return {
		guildId: GUILD,
		messageId: snowflakeAt(Date.now()),
		requiredMessages: 3,
		timespanSeconds: 10,
		userId: USER,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	redis.pTTL.mockResolvedValue(-2);
	redis.zRangeByScore.mockResolvedValue([]);
});

test('a guild requiring one message never touches redis', async () => {
	// The short-circuit legacy had, and the reason `required_messages` bottoms out at 1 rather than 0.
	expect(await isEligibleForXp(options({ requiredMessages: 1 }))).toBe(true);
	expect(redis.pTTL).not.toHaveBeenCalled();
	expect(redis.zAdd).not.toHaveBeenCalled();
});

test('a barred user is turned away without being tracked', async () => {
	redis.pTTL.mockResolvedValue(4_200);

	expect(await isEligibleForXp(options())).toBe(false);
	expect(redis.zAdd).not.toHaveBeenCalled();
});

test('a key with no expiry reads as eligible rather than barring forever', async () => {
	// `PTTL` answers -1 for a key without a TTL and -2 when it's missing; only >= 0 is a live bar.
	redis.pTTL.mockResolvedValue(-1);

	await isEligibleForXp(options());
	expect(redis.zAdd).toHaveBeenCalled();
});

test('an incomplete window tracks the message and denies XP', async () => {
	redis.zRangeByScore.mockResolvedValue([Buffer.from('1'), Buffer.from('2')]);

	expect(await isEligibleForXp(options({ requiredMessages: 3 }))).toBe(false);

	expect(redis.zAdd).toHaveBeenCalledWith(TRACKING_KEY, expect.objectContaining({ value: expect.any(String) }));
	// TTL is the window plus five seconds of slack, so the key can't expire mid-window.
	expect(redis.expire).toHaveBeenCalledWith(TRACKING_KEY, 15);
	expect(redis.set).not.toHaveBeenCalled();
	expect(redis.del).not.toHaveBeenCalled();
});

test('a completed window grants XP, bars the user and clears tracking', async () => {
	const now = Date.now();
	// Oldest message landed 4s into a 10s window, so 6s of it are left.
	redis.zRangeByScore.mockResolvedValue([
		Buffer.from(snowflakeAt(now - 4_000)),
		Buffer.from(snowflakeAt(now - 2_000)),
		Buffer.from(snowflakeAt(now)),
	]);

	expect(await isEligibleForXp(options({ requiredMessages: 3, timespanSeconds: 10 }))).toBe(true);

	expect(redis.set).toHaveBeenCalledWith(INELIGIBLE_KEY, 'true', { PX: expect.any(Number) });

	const [, , setOptions] = redis.set.mock.calls[0]!;
	// The bar is the *remainder* of the window measured from the oldest message, not a flat cooldown -- this is
	// what makes the window genuinely roll.
	expect(setOptions.PX).toBeGreaterThan(5_800);
	expect(setOptions.PX).toBeLessThan(6_200);

	expect(redis.del).toHaveBeenCalledWith(TRACKING_KEY);
});

test('the oldest tracked message is read as a string, not a Buffer', async () => {
	// `createRedis` maps every RESP blob string to a Buffer, so a missing `.toString()` here would make the
	// snowflake parse produce garbage and the bar come out wildly wrong.
	const now = Date.now();
	redis.zRangeByScore.mockResolvedValue([Buffer.from(snowflakeAt(now - 1_000)), Buffer.from(snowflakeAt(now))]);

	expect(await isEligibleForXp(options({ requiredMessages: 2, timespanSeconds: 10 }))).toBe(true);

	const [, , setOptions] = redis.set.mock.calls[0]!;
	expect(setOptions.PX).toBeGreaterThan(8_800);
	expect(setOptions.PX).toBeLessThan(9_200);
});

test('a window already elapsed clamps to a minimal bar rather than inverting', async () => {
	// The snowflake clock (Discord's) and the ZADD score (ours) can disagree, so the remainder can come out
	// negative. Taking its absolute value -- as legacy did -- would bar the user for how far *past* the window
	// they are, which is unrelated to anything. Redis also rejects a PX of 0.
	const now = Date.now();
	redis.zRangeByScore.mockResolvedValue([Buffer.from(snowflakeAt(now - 60_000)), Buffer.from(snowflakeAt(now))]);

	expect(await isEligibleForXp(options({ requiredMessages: 2, timespanSeconds: 10 }))).toBe(true);

	const [, , setOptions] = redis.set.mock.calls[0]!;
	expect(setOptions.PX).toBe(1);
});

test('the tracking trim never cuts inside a window longer than the fixed horizon', async () => {
	// Unreachable while the API caps the timespan at 60s, but the trim horizon and the counting window must not
	// be able to disagree -- trimming first would delete entries the count still needs.
	await isEligibleForXp(options({ timespanSeconds: 1_200 }));

	const [, , max] = redis.zRemRangeByScore.mock.calls[0]!;
	expect(max).toBeLessThanOrEqual(Date.now() - 1_200 * 1_000);
});

test('the tracking set is trimmed to ten minutes regardless of the guild window', async () => {
	await isEligibleForXp(options({ timespanSeconds: 10 }));

	const [key, min, max] = redis.zRemRangeByScore.mock.calls[0]!;
	expect(key).toBe(TRACKING_KEY);
	expect(min).toBe(0);
	expect(max).toBeLessThanOrEqual(Date.now() - 10 * 60 * 1_000);
});
