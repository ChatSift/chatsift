import { setInterval } from 'node:timers';
import type { GuildListKey } from '@chatsift/backend-core';
import { getContext, RedisStore } from '@chatsift/backend-core';
import type { SessionInfo } from '@discordjs/ws';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';

// bin-rw's inferred type widens every field to `| null`, same as `data/bots.ts` and `data/users.ts` -- a stored
// session always has all five, so the cast corrects that.
const sessionRecipe = createRecipe(
	{
		resumeURL: DataType.String,
		sequence: DataType.U32,
		sessionId: DataType.String,
		shardCount: DataType.U32,
		shardId: DataType.U32,
	},
	{ versioned: true },
) as Recipe<SessionInfo>;

// Only a retention bound. What actually decides whether a stored session is usable is Discord, which invalidates
// it server-side long before this -- a stale entry costs exactly one failed RESUME that falls back to IDENTIFY,
// which is the same thing that happens with no entry at all. Generous purely so a shard that is down for a while
// (a long deploy, a crash loop) still finds its entry rather than being punished twice.
const TTL_MS = 24 * 60 * 60 * 1_000;

// How often dirty sessions are flushed to redis. See `createSessionStore` for why this is a write-behind cache and
// what a flush interval actually costs.
const FLUSH_INTERVAL_MS = 5_000;

const store = new RedisStore<SessionInfo>({
	TTL: TTL_MS,
	recipe: sessionRecipe,
	makeKey: (id: string) => `gwsession:${id}`,
	storeOld: false,
});

/**
 * Keyed by bot *and* shard. The bot dimension is required because every bot shares one redis, and it uses the
 * widened `GuildListKey` rather than a bare `BotId` for the same reason `data/bots.ts` does: a custom ModMail
 * instance (#216) is a separate Discord application with its own token and therefore its own gateway sessions,
 * which must not collide with the public deployment's.
 */
const makeId = (botId: GuildListKey, shardId: number): string => `${botId}:${shardId}`;

export interface SessionStore {
	/**
	 * Writes every dirty session to redis. Called on the flush interval, and by graceful shutdown so a planned
	 * restart resumes from the exact sequence it stopped at rather than from up to `FLUSH_INTERVAL_MS` earlier.
	 */
	flush(): Promise<void>;
	retrieveSessionInfo(shardId: number): Promise<SessionInfo | null>;
	updateSessionInfo(shardId: number, sessionInfo: SessionInfo | null): Promise<void>;
}

/**
 * `retrieveSessionInfo`/`updateSessionInfo` for `WebSocketManager`, backed by redis so a restart RESUMEs instead
 * of re-IDENTIFYing.
 *
 * At one shard this is a small nicety (no missed events across a deploy). It stops being optional once a bot runs
 * more than a handful of shards: IDENTIFY is gated by `session_start_limit.max_concurrency`, so a full re-identify
 * of every shard on every restart scales linearly in reconnect time and burns a daily budget RESUME doesn't touch.
 * It is also what makes `lib/replica.ts`'s exit-on-coverage-change affordable -- that design deliberately restarts
 * a replica to change its shard set, which is only cheap if restarts resume.
 *
 * **Write-behind, deliberately.** `@discordjs/ws` calls both of these on *every dispatch event* to advance the
 * stored sequence number, not just on Ready -- so a straight redis-backed implementation would put two round trips
 * in front of every Discord event this process handles. Memory is therefore the hot path and the authoritative
 * copy while the process is alive; redis is written every `FLUSH_INTERVAL_MS` and on shutdown, and read exactly
 * once per shard (the first `retrieveSessionInfo` after boot, when memory is still cold).
 *
 * What a flush interval costs is bounded and cheap: after an *unplanned* death the stored sequence can be up to
 * one interval stale, so the RESUME replays a few seconds of events that were already handled. Replay is normal
 * gateway behaviour that handlers must tolerate regardless (see `11-automoderator-port.md`'s idempotency
 * invariant), and replaying a handful of events is strictly better than the alternative of not resuming at all.
 *
 * A redis failure must never stop a shard connecting -- a missing session just means IDENTIFY, which is the
 * correct fallback -- so reads and flushes swallow their errors after logging.
 */
export function createSessionStore(botId: GuildListKey): SessionStore {
	const sessions = new Map<number, SessionInfo>();
	const dirty = new Set<number>();

	async function flush(): Promise<void> {
		if (dirty.size === 0) {
			return;
		}

		// Snapshot and clear first: an `updateSessionInfo` landing while the writes below are in flight must
		// re-mark the shard dirty rather than have its newer sequence silently dropped by a clear afterwards.
		const shardIds = [...dirty];
		dirty.clear();

		await Promise.all(
			shardIds.map(async (shardId) => {
				const session = sessions.get(shardId);
				try {
					if (session) {
						await store.set(makeId(botId, shardId), session);
					} else {
						await store.delete(makeId(botId, shardId));
					}
				} catch (error) {
					getContext().logger.error({ err: error, shardId }, 'failed to persist gateway session info');
				}
			}),
		);
	}

	setInterval(() => {
		void flush();
	}, FLUSH_INTERVAL_MS).unref();

	return {
		flush,

		async retrieveSessionInfo(shardId: number): Promise<SessionInfo | null> {
			const cached = sessions.get(shardId);
			if (cached) {
				return cached;
			}

			try {
				const stored = await store.get(makeId(botId, shardId));
				if (stored) {
					sessions.set(shardId, stored);
				}

				return stored;
			} catch (error) {
				getContext().logger.error({ err: error, shardId }, 'failed to read gateway session info, will identify');
				return null;
			}
		},

		async updateSessionInfo(shardId: number, sessionInfo: SessionInfo | null): Promise<void> {
			// discord.js hands us `null` to mean "this session is gone" (invalidated, or a destroy not meant to
			// resume). Keeping the entry would guarantee a failed RESUME on next boot, so it's dropped from memory
			// immediately and the deletion is flushed with everything else.
			if (sessionInfo === null) {
				sessions.delete(shardId);
			} else {
				sessions.set(shardId, sessionInfo);
			}

			dirty.add(shardId);
		},
	};
}
