import { setInterval } from 'node:timers';
import type { GuildListKey } from '@chatsift/backend-core';
import { getContext, RedisStore } from '@chatsift/backend-core';
import type { SessionInfo } from '@discordjs/ws';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';
import { onShutdown } from './shutdown.js';

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

// How often dirty sessions are flushed to redis.
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

const sessions = new Map<number, SessionInfo>();
const dirty = new Set<number>();
let currentBotId: GuildListKey | null = null;

function requireBotId(): GuildListKey {
	if (!currentBotId) {
		throw new Error('Session store has not been started yet');
	}

	return currentBotId;
}

export async function flushSessions(): Promise<void> {
	if (dirty.size === 0) {
		return;
	}

	const botId = requireBotId();

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
				// Put it back: at runtime the next dispatch event would re-mark it anyway, but the shutdown
				// flush has no next event, so silently dropping it here would lose exactly the resume point
				// that flush exists to persist.
				dirty.add(shardId);
				getContext().logger.error({ err: error, shardId }, 'failed to persist gateway session info');
			}
		}),
	);
}

export async function retrieveSessionInfo(shardId: number): Promise<SessionInfo | null> {
	const cached = sessions.get(shardId);
	if (cached) {
		return cached;
	}

	try {
		const stored = await store.get(makeId(requireBotId(), shardId));
		if (stored) {
			sessions.set(shardId, stored);
		}

		return stored;
	} catch (error) {
		getContext().logger.error({ err: error, shardId }, 'failed to read gateway session info, will identify');
		return null;
	}
}

export async function updateSessionInfo(shardId: number, sessionInfo: SessionInfo | null): Promise<void> {
	if (sessionInfo === null) {
		sessions.delete(shardId);
	} else {
		sessions.set(shardId, sessionInfo);
	}

	dirty.add(shardId);
}

/**
 * Forgets every session, in memory and in redis, so the next boot IDENTIFYs rather than RESUMEs. The escape
 * hatch for state only a fresh READY can rebuild -- see `client.ts`'s guild list, which is exactly that.
 */
export async function invalidateStoredSessions(): Promise<void> {
	for (const shardId of sessions.keys()) {
		sessions.delete(shardId);
		dirty.add(shardId);
	}

	await flushSessions();
}

export function startSessionStore(botId: GuildListKey): void {
	currentBotId = botId;

	setInterval(() => {
		void flushSessions();
	}, FLUSH_INTERVAL_MS).unref();

	onShutdown('gateway-sessions', async () => flushSessions());
}
