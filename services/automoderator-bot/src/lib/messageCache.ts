import { getContext, RedisStore } from '@chatsift/backend-core';
import { formatCaseUserTag } from '@chatsift/core';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';
import { messageCacheLookups } from './metrics.js';

/**
 * The message cache (P4, feature 34).
 *
 * Load-bearing rather than an optimization: Discord's `MESSAGE_DELETE` carries an id and nothing else, and
 * `MESSAGE_UPDATE` carries only what changed, so **without a cache there is no "what did the deleted message
 * say"** -- which is the whole feature. Legacy kept exactly this, in redis, for exactly this reason.
 *
 * Redis rather than a process-local `Map` for the reason `docs/roadmap/12-horizontal-scaling.md` gives: a
 * replica restart or a reshard must not blank a guild's edit/delete logging for the next day. It is still only
 * a cache -- a miss logs nothing and says so through `messageCacheLookups`, which is the counter that tells
 * you the `MessageContent` intent was never granted.
 */

/**
 * The narrowed shape actually persisted, which is deliberately not `APIMessage`. Two reasons, and the first is
 * the one that matters: this is user-authored content sitting in redis for a day, so the less of it stored the
 * better. Everything here is something an edit or delete embed renders. Reactions, components, mentions,
 * referenced messages and the rest are dropped by the recipe below whether or not a call site remembers to.
 */
export interface CachedMessage {
	readonly attachmentCount: number;
	readonly authorAvatar: string | null;
	readonly authorId: string;
	readonly authorTag: string;
	readonly channelId: string;
	readonly content: string;
	readonly guildId: string;
	readonly messageId: string;
}

const messageRecipe = createRecipe(
	{
		messageId: DataType.String,
		channelId: DataType.String,
		guildId: DataType.String,
		authorId: DataType.String,
		authorTag: DataType.String,
		authorAvatar: DataType.String,
		content: DataType.String,
		attachmentCount: DataType.I32,
	},
	{ versioned: true },
	// bin-rw's inferred type is wider than `CachedMessage` -- every `DataType.String` decodes as
	// `string | null`, whereas `authorAvatar` is the only genuinely nullable field. Same cast every other
	// recipe in this codebase needs.
) as Recipe<CachedMessage>;

/**
 * How long a message stays retrievable. **Sized, not left to grow**: a busy guild produces messages far faster
 * than moderators read logs, and every one of them is a redis key holding somebody's text.
 *
 * A day is the point past which "what did that deleted message say" is answered by scrolling the log rather
 * than by the bot -- the delete embed itself is permanent, only the *content lookup* expires. Paired with
 * `MAX_PER_CHANNEL` below, which is the bound that actually holds under a raid: TTL alone would let one
 * channel's flood sit in memory for the full window.
 */
export const MESSAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * The hard per-channel bound, evicting oldest-first. Legacy's number, kept: 5,000 messages is deeper than any
 * moderator scrolls and shallow enough that a spam flood in one channel cannot push a quiet channel's history
 * out, because the bound is per channel rather than global.
 */
export const MESSAGE_CACHE_MAX_PER_CHANNEL = 5_000;

const store = new RedisStore<CachedMessage>({
	TTL: MESSAGE_CACHE_TTL_MS,
	recipe: messageRecipe,
	makeKey: (messageId: string) => `automoderator:message:${messageId}`,
	// The TTL is a retention bound on somebody's message text, not a "still wanted" signal -- an edit five
	// minutes before the window closes must not buy the original another full day in redis.
	refreshTTLOnRead: false,
	storeOld: false,
});

/**
 * Insertion order for one channel, which is what makes `MAX_PER_CHANNEL` evictable. Kept separate from the
 * message keys because redis cannot tell you which keys belong to a channel without a scan.
 */
const channelIndexKey = (channelId: string): string => `automoderator:messages:${channelId}`;

/**
 * What a call site must hand over, structural rather than `APIMessage`: `MESSAGE_CREATE` and `MESSAGE_UPDATE`
 * arrive as `GatewayMessage*DispatchData`, which are *not* assignable to `APIMessage` (their `mentions` carry
 * a member object the REST shape doesn't). Naming only the fields this cache reads sidesteps that entirely and
 * documents the dependency at the same time.
 */
export interface CacheableMessage {
	readonly attachments: readonly unknown[];
	readonly author: {
		readonly avatar: string | null;
		readonly bot?: boolean | undefined;
		readonly discriminator: string;
		readonly id: string;
		readonly username: string;
	};
	readonly channel_id: string;
	readonly content: string;
	readonly guild_id?: string | undefined;
	readonly id: string;
	readonly webhook_id?: string | undefined;
}

/**
 * Whether a message is worth caching at all. Bots and webhooks are excluded at the *write* -- legacy filtered
 * them at the read instead, which meant a webhook-heavy channel spent its whole 5,000-entry budget on messages
 * the log would then refuse to render.
 */
export function isLoggableMessage(message: CacheableMessage): boolean {
	return Boolean(message.guild_id) && !message.author.bot && !message.webhook_id;
}

export async function cacheMessage(message: CacheableMessage): Promise<void> {
	if (!isLoggableMessage(message)) {
		return;
	}

	const { redis } = getContext();
	const key = channelIndexKey(message.channel_id);
	const existed = await store.has(message.id);

	await store.set(message.id, {
		messageId: message.id,
		channelId: message.channel_id,
		guildId: message.guild_id!,
		authorId: message.author.id,
		authorTag: formatCaseUserTag(message.author),
		authorAvatar: message.author.avatar,
		content: message.content,
		attachmentCount: message.attachments.length,
	});

	// Only new messages extend the index; an edit rewrites the value in place. Without this an actively-edited
	// message would take a slot per edit and evict unrelated history.
	if (existed) {
		return;
	}

	await redis.rPush(key, message.id);
	await redis.pExpire(key, MESSAGE_CACHE_TTL_MS);

	const size = await redis.lLen(key);
	if (size <= MESSAGE_CACHE_MAX_PER_CHANNEL) {
		return;
	}

	// `lPopCount` returns what it removed, which is the only reason the bound can be enforced without leaking
	// the message keys behind the evicted ids -- `lTrim` would silently orphan them until their own TTL.
	const evicted = await redis.lPopCount(key, size - MESSAGE_CACHE_MAX_PER_CHANNEL);
	for (const id of evicted ?? []) {
		await store.delete(id.toString());
	}
}

/**
 * Reads a message back, counting the hit or miss. **Every read goes through here** rather than through `store`
 * directly, because a flat-zero `hit` is what says the `MessageContent` intent is missing -- and that failure
 * is otherwise completely silent: the bot still receives the delete, still finds no content, and still logs
 * nothing.
 */
export async function getCachedMessage(messageId: string): Promise<CachedMessage | null> {
	const cached = await store.get(messageId);
	messageCacheLookups.inc({ result: cached ? 'hit' : 'miss' });
	return cached;
}

/**
 * Drops a message that has just been deleted. The channel index entry is left to expire with the list's own
 * TTL: removing it means an `LREM` linear scan of up to 5,000 entries per delete, and a stale id costs one
 * already-expired lookup during eviction.
 */
export async function dropCachedMessage(messageId: string): Promise<void> {
	await store.delete(messageId);
}
