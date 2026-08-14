// From `@chatsift/core` rather than `@chatsift/backend-core` (which re-exports it): backend-core parses the
// env schema at import time, and nothing in this module needs a configured process.
import { memoizeAsync } from '@chatsift/core';
import type { API, Snowflake } from '@discordjs/core';

/**
 * The bot's own user id.
 *
 * READY carries it (`data.user.id`), so in the normal case this costs nothing -- `createBotClient` records it
 * there and every later read is a variable. The fetch is the fallback for a process that only ever RESUMEd,
 * which is the ordinary shape of a restart since the session store landed: RESUMED has no payload, so a bot
 * that never sees a READY has to ask. Same reason `bootstrapOnce` takes an optional application id.
 *
 * Deliberately *not* the application id: the two are equal for a bot application, but "who am I on Discord" is
 * the question call sites actually ask (is this audit-log entry mine, what are my roles in this guild), and
 * leaning on that equivalence would be a coupling nothing enforces.
 */
let selfId: Snowflake | null = null;
let fetchSelfId: (() => Promise<Snowflake>) | null = null;

export function setSelfId(id: Snowflake): void {
	selfId = id;
}

export async function getSelfId(api: API): Promise<Snowflake> {
	if (selfId !== null) {
		return selfId;
	}

	// Built on first use so the `api` is whatever the client was constructed with, and memoized so a bot that
	// resumed doesn't re-ask per call -- `memoizeAsync` is also what keeps a transient failure from being
	// remembered as the answer forever.
	fetchSelfId ??= memoizeAsync(async () => {
		const currentUser = await api.users.getCurrent();
		setSelfId(currentUser.id);
		return currentUser.id;
	});

	return fetchSelfId();
}
