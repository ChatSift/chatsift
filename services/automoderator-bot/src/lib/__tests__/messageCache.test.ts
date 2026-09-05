import { Buffer } from 'node:buffer';
import { beforeEach, expect, test, vi } from 'vitest';

/**
 * Just enough redis for the four commands the cache issues, plus the list the per-channel bound is enforced
 * against. Values are the encoded `Buffer`s, not the objects, so the recipe round trip below is the real one --
 * which is the half of this module most able to break quietly, since a field that decodes wrong writes a lie
 * into a moderation log rather than throwing.
 */
class FakeRedis {
	public readonly strings = new Map<string, Buffer>();

	public readonly lists = new Map<string, string[]>();

	public readonly expiries = new Map<string, number>();

	public async exists(key: string): Promise<number> {
		return this.strings.has(key) ? 1 : 0;
	}

	public async get(key: string): Promise<Buffer | null> {
		return this.strings.get(key) ?? null;
	}

	public async set(key: string, raw: Buffer): Promise<void> {
		this.strings.set(key, raw);
	}

	public async del(keys: string[]): Promise<void> {
		for (const key of keys) {
			this.strings.delete(key);
		}
	}

	public async pExpire(key: string, ttl: number): Promise<void> {
		this.expiries.set(key, ttl);
	}

	public async rPush(key: string, value: string): Promise<void> {
		this.lists.set(key, [...(this.lists.get(key) ?? []), value]);
	}

	public async lLen(key: string): Promise<number> {
		return this.lists.get(key)?.length ?? 0;
	}

	public async lPopCount(key: string, count: number): Promise<Buffer[]> {
		const list = this.lists.get(key) ?? [];
		const popped = list.slice(0, count);
		this.lists.set(key, list.slice(count));
		// The real client hands blob replies back as buffers, which is why the module calls `.toString()` on
		// each one before deleting it.
		return popped.map((id) => Buffer.from(id));
	}
}

let redis = new FakeRedis();

/**
 * The four `RedisStore` methods this module uses, re-implemented against the fake above rather than stubbed
 * out. The entity's own `recipe` and `makeKey` do the work, so what these tests exercise is the encoding the
 * production store would use, not a stand-in for it.
 */
class FakeRedisStore<ValueType> {
	public constructor(
		private readonly entity: {
			makeKey(id: string): string;
			recipe: { decode(raw: Buffer): ValueType; encode(value: ValueType): Buffer };
		},
	) {}

	public async has(id: string): Promise<boolean> {
		return Boolean(await redis.exists(this.entity.makeKey(id)));
	}

	public async get(id: string): Promise<ValueType | null> {
		const raw = await redis.get(this.entity.makeKey(id));
		return raw ? this.entity.recipe.decode(raw) : null;
	}

	public async set(id: string, value: ValueType): Promise<void> {
		await redis.set(this.entity.makeKey(id), this.entity.recipe.encode(value));
	}

	public async delete(id: string): Promise<void> {
		await redis.del([this.entity.makeKey(id)]);
	}
}

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({ redis }),
	RedisStore: FakeRedisStore,
}));

vi.mock('@chatsift/core', () => ({
	formatCaseUserTag: (user: { username: string }) => user.username,
}));

const lookups: string[] = [];
vi.mock('../metrics.js', () => ({
	messageCacheLookups: { inc: ({ result }: { result: string }) => lookups.push(result) },
}));

const {
	cacheMessage,
	dropCachedMessage,
	getCachedMessage,
	isLoggableMessage,
	MESSAGE_CACHE_MAX_PER_CHANNEL,
	MESSAGE_CACHE_TTL_MS,
} = await import('../messageCache.js');

const AUTHOR = { id: 'author', username: 'someone', discriminator: '0', avatar: 'avatarhash' };

function message(overrides: Record<string, unknown> = {}) {
	return {
		id: 'message',
		channel_id: 'channel',
		guild_id: 'guild',
		author: AUTHOR,
		content: 'hello',
		attachments: [],
		...overrides,
	};
}

const INDEX_KEY = 'automoderator:messages:channel';

beforeEach(() => {
	redis = new FakeRedis();
	lookups.length = 0;
});

test('a plain guild message is loggable', () => {
	expect(isLoggableMessage(message())).toBe(true);
});

// Filtered at the *write* rather than at the read, which is the change from legacy: a webhook-heavy channel
// would otherwise spend its whole per-channel budget on messages the log then refuses to render.
test.each([
	['a bot', { author: { ...AUTHOR, bot: true } }],
	['a webhook', { webhook_id: 'webhook' }],
])('%s is not cached', (_name, overrides) => {
	expect(isLoggableMessage(message(overrides))).toBe(false);
});

// A reduced `MESSAGE_UPDATE` must be refused rather than diffed against: treating an absent `content` as an
// empty one would post an edit whose "After" is blank.
test.each([
	['no content', { content: undefined }],
	['no guild', { guild_id: undefined }],
	['no author', { author: undefined }],
	['no attachments', { attachments: undefined }],
])('a payload with %s is not cached', (_name, overrides) => {
	expect(isLoggableMessage(message(overrides))).toBe(false);
});

// An attachment-only message is a real message with genuinely empty text, so `''` has to survive the round
// trip as `''` -- decoding it as null would be the difference between "they posted an image" and a crash.
test('an empty message round trips as empty rather than absent', async () => {
	await cacheMessage(message({ content: '', attachments: [{}, {}] }));

	const cached = await getCachedMessage('message');
	expect(cached?.content).toBe('');
	expect(cached?.attachmentCount).toBe(2);
});

test('a member with no avatar round trips as null', async () => {
	await cacheMessage(message({ author: { ...AUTHOR, avatar: null } }));

	expect((await getCachedMessage('message'))?.authorAvatar).toBeNull();
});

test('everything the delete embed renders survives the round trip', async () => {
	await cacheMessage(message());

	expect(await getCachedMessage('message')).toEqual({
		messageId: 'message',
		channelId: 'channel',
		guildId: 'guild',
		authorId: 'author',
		authorTag: 'someone',
		authorAvatar: 'avatarhash',
		content: 'hello',
		attachmentCount: 0,
	});
});

test('a lookup is counted either way', async () => {
	await getCachedMessage('nothing');
	await cacheMessage(message());
	await getCachedMessage('message');

	expect(lookups).toEqual(['miss', 'hit']);
});

test('a deleted message is dropped', async () => {
	await cacheMessage(message());
	await dropCachedMessage('message');

	expect(await getCachedMessage('message')).toBeNull();
});

test('a new message takes one slot in its channel index', async () => {
	await cacheMessage(message({ id: 'one' }));
	await cacheMessage(message({ id: 'two' }));

	expect(redis.lists.get(INDEX_KEY)).toEqual(['one', 'two']);
	expect(redis.expiries.get(INDEX_KEY)).toBe(MESSAGE_CACHE_TTL_MS);
});

// Without this an actively-edited message would take a slot per edit and evict unrelated history.
test('an edit rewrites in place rather than taking another slot', async () => {
	await cacheMessage(message({ content: 'before' }));
	await cacheMessage(message({ content: 'after' }));

	expect(redis.lists.get(INDEX_KEY)).toEqual(['message']);
	expect((await getCachedMessage('message'))?.content).toBe('after');
});

// The bound that actually holds under a raid -- the TTL alone would let one channel's flood sit in redis for
// the full day. Per channel rather than global, so a spam flood cannot push a quiet channel's history out.
test('exceeding the per-channel bound evicts the oldest', async () => {
	// Cached for real, so there is a message key behind the id the eviction is going to reach for. The rest of
	// the channel's history only has to occupy slots, so it goes straight into the index.
	await cacheMessage(message({ id: 'oldest' }));
	redis.lists.set(INDEX_KEY, [
		'oldest',
		...Array.from({ length: MESSAGE_CACHE_MAX_PER_CHANNEL - 1 }, (_, index) => `filler-${index}`),
	]);

	await cacheMessage(message({ id: 'newest' }));

	const list = redis.lists.get(INDEX_KEY)!;
	expect(list.length).toBe(MESSAGE_CACHE_MAX_PER_CHANNEL);
	expect(list.at(-1)).toBe('newest');
	expect(list).not.toContain('oldest');

	// The point of popping rather than trimming: the message key behind the evicted id goes too, instead of
	// being orphaned until its own TTL.
	expect(await getCachedMessage('oldest')).toBeNull();
	expect(await getCachedMessage('newest')).not.toBeNull();
});
