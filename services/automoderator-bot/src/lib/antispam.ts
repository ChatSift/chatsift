import { getContext } from '@chatsift/backend-core';

/**
 * Anti-spam (P5c, feature 07): more messages from one member inside a window than the guild allows.
 *
 * A redis sorted set per (guild, member), scored by arrival time -- legacy's mechanism, kept, because it is the
 * right one: the window has to slide, and a counter with a TTL cannot express "six in the last five seconds"
 * without either resetting mid-burst or never resetting at all.
 *
 * Redis rather than a process-local `Map` for the reason `docs/roadmap/12-horizontal-scaling.md` gives, and more
 * sharply here than for the message cache: a guild's messages are spread across shards by *channel*, so two
 * replicas can both be receiving one member's burst, and a per-process window would see each half and trip on
 * neither.
 */

/**
 * One message in a burst, as stored. The channel travels with the id because the burst is deleted per channel
 * and a burst can span several -- the window is keyed on the member, not on where they posted.
 *
 * Legacy stored bare message ids and looked each one up in its message cache to find the channel, which made
 * anti-spam quietly depend on a cache that can miss (and, without the `MessageContent` intent, misses in a way
 * nothing reports). Two fields in the sorted-set member removes that dependency entirely.
 */
export interface BurstMessage {
	readonly channelId: string;
	readonly messageId: string;
}

export interface AntispamSettings {
	/**
	 * Messages, inclusive: `amount` inside the window is a burst.
	 */
	readonly amount: number;
	readonly windowSeconds: number;
}

export interface AntispamHit {
	/**
	 * Every message in the burst, oldest first -- the whole burst is removed, not just the one that tipped it
	 * over. Deleting only the last message leaves the spam and the member's impression that nothing happened.
	 */
	readonly messages: BurstMessage[];
}

const key = (guildId: string, userId: string): string => `automoderator:antispam:${guildId}:${userId}`;

/**
 * `channelId/messageId`. A slash because neither half can contain one, so the split is unambiguous without
 * escaping.
 */
function encode(message: BurstMessage): string {
	return `${message.channelId}/${message.messageId}`;
}

function decode(entry: string): BurstMessage | null {
	const separator = entry.indexOf('/');
	if (separator <= 0 || separator === entry.length - 1) {
		return null;
	}

	return { channelId: entry.slice(0, separator), messageId: entry.slice(separator + 1) };
}

/**
 * Records a message and says whether it completed a burst.
 *
 * **Records first, then counts**, so the message that tips the guild's threshold is itself part of the burst
 * that gets deleted. Counting first would leave the offending message behind every time.
 *
 * A burst clears the window (legacy did the same): the next message starts a fresh count rather than tripping
 * again immediately, which is what stops one flood from filing a punishment per message after the first.
 */
export async function recordMessage(
	guildId: string,
	author: string,
	message: BurstMessage,
	{ amount, windowSeconds }: AntispamSettings,
): Promise<AntispamHit | null> {
	const { redis } = getContext();
	const windowKey = key(guildId, author);
	const now = Date.now();
	const windowMs = windowSeconds * 1_000;

	await redis.zAdd(windowKey, { score: now, value: encode(message) });
	// Trimmed on write rather than filtered on read, which keeps the set bounded by the window instead of by how
	// long the member keeps talking -- and makes the read below a plain index range.
	await redis.zRemRangeByScore(windowKey, '-inf', now - windowMs);
	// A member who stops talking must not hold a key forever. Refreshed on every message, which is correct here
	// and precisely the opposite of the message cache's `refreshTTLOnRead: false` -- this TTL tracks a sliding
	// window, that one is a retention bound on somebody's text.
	await redis.pExpire(windowKey, windowMs);

	const entries = await redis.zRange(windowKey, 0, -1);
	if (entries.length < amount) {
		return null;
	}

	await redis.del(windowKey);

	// `.toString()` because the client maps blob strings to `Buffer` -- see `createRedis`. A member that no
	// longer parses is dropped rather than failing the burst: it can only come from an older encoding, and
	// refusing to act on a flood because one entry is unreadable is the wrong direction.
	const messages = entries.map((entry) => decode(entry.toString())).filter((entry) => entry !== null);

	return messages.length > 0 ? { messages } : null;
}

/**
 * A guild's anti-spam configuration, or null when it has none.
 *
 * The pair moves together -- `automoderator_guild_settings_antispam_check` enforces it, and the API rejects a
 * partial write -- so a half-set row cannot exist. This still checks both, and checks for a *number* rather
 * than for `!== null`, because the failure that gets past a null check is a window of `undefined`: the filter
 * then reads as enabled and every comparison against it is false, which is a filter that is on and can never
 * fire. Nothing reports that.
 */
export function resolveAntispamSettings(settings: {
	antispamAmount: number | null;
	antispamTime: number | null;
}): AntispamSettings | null {
	const { antispamAmount, antispamTime } = settings;

	if (typeof antispamAmount !== 'number' || typeof antispamTime !== 'number') {
		return null;
	}

	return { amount: antispamAmount, windowSeconds: antispamTime };
}
