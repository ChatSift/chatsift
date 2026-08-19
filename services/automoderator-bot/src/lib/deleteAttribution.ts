/**
 * Who deleted somebody else's message (P4, feature 34).
 *
 * Discord's `MESSAGE_DELETE` never says who did it, and a message a member deletes themselves produces no audit
 * entry at all -- so the only signal is `MESSAGE_DELETE` audit entries, matched against the delete by author and
 * channel.
 *
 * **Fed from the gateway, not fetched.** `auditObserver.ts` already subscribes to
 * `GUILD_AUDIT_LOG_ENTRY_CREATE`, so attribution costs nothing extra; legacy instead issued a
 * `GET /guilds/{id}/audit-logs` **per deleted message**, which a hundred-message purge turns into a hundred
 * rate-limited requests. It is also more accurate: Discord *aggregates* repeated deletes by one moderator on one
 * author in one channel into a single audit entry, so the fetch-per-delete approach sees a stale entry from
 * minutes ago (or, on the second message onward, no new entry at all) while a buffered one matches every
 * message in the burst.
 *
 * Legacy also compared the audit entry's `target_id` against the *message* id. `target_id` on a MESSAGE_DELETE
 * entry is the **author**, so that comparison never matched and legacy attributed nothing, ever. The footer it
 * built for this was dead code for five years.
 */

interface BufferedDelete {
	readonly moderatorId: string;
	recordedAt: number;
}

/**
 * How long an audit entry stays eligible to explain a delete. Generous rather than tight because the ordering
 * between `MESSAGE_DELETE` and `GUILD_AUDIT_LOG_ENTRY_CREATE` is not guaranteed either way, and because a
 * purge's later deletes arrive well after the one entry that covers them all.
 *
 * **An entry is matched, never consumed**, and that is the trade-off worth stating plainly: within the window,
 * a member deleting one of their *own* messages in a channel a moderator has just cleaned up is credited to
 * that moderator. Nothing can distinguish the two, because Discord files no audit entry for a self-delete --
 * so the choice is between occasionally naming the wrong person and abandoning attribution during a purge,
 * which is the only time anyone is reading for it. Legacy attributed nothing at all (its `target_id`
 * comparison never matched), so either reading is an improvement; this one is the useful improvement.
 *
 * Consuming the entry instead was considered and does not work: Discord *aggregates* a moderator's repeated
 * deletes into one audit entry and emits the gateway event only when that entry is first created, so a
 * hundred-message purge has exactly one entry to spend.
 */
const ATTRIBUTION_WINDOW_MS = 60_000;

/**
 * How long a delete waits for its audit entry before giving up and logging unattributed. Both events come over
 * the same gateway connection microseconds apart in practice; this is slack, not a poll interval.
 */
export const ATTRIBUTION_GRACE_MS = 1_500;

/**
 * Bounded so a raid cannot grow this without limit. Entries are per (guild, channel, author) triple rather than
 * per message -- that is what makes a burst one entry -- so the practical size is small and this is a backstop.
 */
const MAX_ENTRIES = 5_000;

const buffer = new Map<string, BufferedDelete>();

const bufferKey = (guildId: string, channelId: string, authorId: string): string =>
	`${guildId}:${channelId}:${authorId}`;

function prune(now: number): void {
	for (const [key, entry] of buffer) {
		if (now - entry.recordedAt >= ATTRIBUTION_WINDOW_MS) {
			buffer.delete(key);
		}
	}

	// Only reachable if more than MAX_ENTRIES distinct triples are deleted from inside one window. Insertion
	// order is roughly recency order, so dropping from the front sheds the oldest.
	while (buffer.size > MAX_ENTRIES) {
		const oldest = buffer.keys().next();
		if (oldest.done) {
			break;
		}

		buffer.delete(oldest.value);
	}
}

/**
 * Records that a moderator deleted a message. Re-recording refreshes the window, which is what keeps a long
 * purge attributed all the way through rather than only for its first minute.
 */
export function recordMessageDeleteAudit(
	guildId: string,
	channelId: string,
	authorId: string,
	moderatorId: string,
	now = Date.now(),
): void {
	prune(now);
	buffer.set(bufferKey(guildId, channelId, authorId), { moderatorId, recordedAt: now });
}

/**
 * The moderator who deleted this message, or `null` when nobody did -- which is both "the author deleted it
 * themselves" and "we never saw an audit entry". Those two are genuinely indistinguishable here (Discord files
 * no entry for a self-delete), and the embed says "deleted by" only when there is somebody to name rather than
 * asserting a self-delete it cannot prove.
 */
export function findDeleteModerator(
	guildId: string,
	channelId: string,
	authorId: string,
	now = Date.now(),
): string | null {
	const entry = buffer.get(bufferKey(guildId, channelId, authorId));
	if (!entry || now - entry.recordedAt >= ATTRIBUTION_WINDOW_MS) {
		return null;
	}

	return entry.moderatorId;
}

/**
 * Test seam only -- the buffer is module state shared by every guild, and a test that left entries behind would
 * leak them into the next one.
 */
export function clearDeleteAttribution(): void {
	buffer.clear();
}
