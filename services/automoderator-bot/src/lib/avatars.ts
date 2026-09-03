import type { Logger } from '@chatsift/backend-core';
import { fetchUser } from '@chatsift/bot-core';
import { displayAvatarURL } from '@chatsift/core';
import type { API } from '@discordjs/core';

/**
 * The avatar to draw on an embed built from a database row rather than from a Discord payload -- a case, a
 * report card (#377). Neither table stores an avatar, so the account has to be resolved.
 *
 * Best-effort by construction: the lookup goes through `bot-core`'s cross-bot redis cache, so it is usually
 * free, and *nothing* about it is allowed to cost the guild the log entry it decorates. A rate limit, a dead
 * token or an account Discord no longer knows about all come back `undefined`, which renders an author line
 * with no icon -- exactly what these embeds looked like before.
 */
export async function resolveAvatarURL(api: API, userId: string, logger: Logger): Promise<string | undefined> {
	try {
		const user = await fetchUser(api, userId);
		return user ? displayAvatarURL(user.id, user.avatar) : undefined;
	} catch (error) {
		logger.warn({ err: error, userId }, 'could not resolve an avatar for an embed');
		return undefined;
	}
}
