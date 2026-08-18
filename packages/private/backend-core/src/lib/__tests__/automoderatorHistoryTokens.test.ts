import { Buffer } from 'node:buffer';
import { beforeEach, expect, test, vi } from 'vitest';
import {
	HISTORY_TOKEN_TTL_MINUTES,
	mintHistoryToken,
	resolveHistoryToken,
} from '../data/automoderatorHistoryTokens.js';

// Values are Buffers because the real client is built
// `.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })`, and because these tokens are stored through
// `RedisStore`, whose bin-rw recipe encodes to binary rather than to JSON text.
const values = new Map<string, Buffer>();
const expiries = new Map<string, number>();
let now = 1_000_000;

function live(key: string): boolean {
	const expiresAt = expiries.get(key);
	if (expiresAt !== undefined && expiresAt <= now) {
		values.delete(key);
		expiries.delete(key);
		return false;
	}

	return values.has(key);
}

const pExpire = vi.fn();

vi.mock('../context.js', () => ({
	getContext: () => ({
		logger: { warn: () => undefined },
		redis: {
			async get(key: string) {
				return live(key) ? values.get(key)! : null;
			},
			async set(key: string, value: Buffer | string, options?: { expiration?: { type: 'PX'; value: number } }) {
				values.set(key, typeof value === 'string' ? Buffer.from(value) : value);
				if (options?.expiration) {
					expiries.set(key, now + options.expiration.value);
				}

				return 'OK';
			},
			async exists(key: string) {
				return live(key) ? 1 : 0;
			},
			async del(keys: string[] | string) {
				let removed = 0;
				for (const key of Array.isArray(keys) ? keys : [keys]) {
					if (live(key)) {
						removed++;
					}

					values.delete(key);
					expiries.delete(key);
				}

				return removed;
			},
			async pExpire(key: string, ttl: number) {
				pExpire(key, ttl);
				if (!live(key)) {
					return 0;
				}

				expiries.set(key, now + ttl);
				return 1;
			},
		},
	}),
}));

beforeEach(() => {
	values.clear();
	expiries.clear();
	pExpire.mockClear();
	now = 1_000_000;
});

test('a token round-trips the guild and user it names', async () => {
	const token = await mintHistoryToken({ guildId: '1', userId: '2' });

	expect(await resolveHistoryToken(token)).toEqual({ guildId: '1', userId: '2' });
});

test('two mints for the same target are different tokens', async () => {
	// Otherwise one person's `/myhistory` link would resolve to somebody else's still-live capability.
	const first = await mintHistoryToken({ guildId: '1', userId: '2' });
	const second = await mintHistoryToken({ guildId: '1', userId: '2' });

	expect(first).not.toBe(second);
});

test('the TTL is an absolute budget, not an idle timeout', async () => {
	// This is a capability handed out in a Discord reply. Reloading the page it points at must not keep
	// extending how long the link stays live -- which is what a sliding TTL would do.
	const token = await mintHistoryToken({ guildId: '1', userId: '2' });

	now += 4 * 60 * 1_000;
	expect(await resolveHistoryToken(token)).not.toBeNull();
	expect(pExpire).not.toHaveBeenCalled();

	now += 2 * 60 * 1_000;
	expect(await resolveHistoryToken(token)).toBeNull();
});

test('the advertised minutes match the TTL actually written', async () => {
	// The bot puts this number in front of the user; a drift between the copy and the expiry is a link that
	// dies before it says it will.
	const token = await mintHistoryToken({ guildId: '1', userId: '2' });

	now += HISTORY_TOKEN_TTL_MINUTES * 60_000 - 1;
	expect(await resolveHistoryToken(token)).not.toBeNull();

	now += 1;
	expect(await resolveHistoryToken(token)).toBeNull();
});

test('an unknown token resolves to nothing rather than throwing', async () => {
	expect(await resolveHistoryToken('6f1c2d0e-0000-4000-8000-000000000000')).toBeNull();
});

test('a token whose stored bytes do not match the recipe is evicted, not decoded', async () => {
	// The reason these moved to a `versioned` recipe: a payload written by older code must read as "expired"
	// rather than as a half-populated target that would query the wrong guild's cases.
	const token = await mintHistoryToken({ guildId: '1', userId: '2' });
	values.set('automoderator:historytoken:' + token, Buffer.from('not a recipe payload'));

	expect(await resolveHistoryToken(token)).toBeNull();
	expect(await resolveHistoryToken(token)).toBeNull();
});
