import { fetchUserCached } from '@chatsift/backend-core';
import type { API, APIUser, Snowflake } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';

/**
 * Bot-side twin of `services/api`'s `util/users.ts`: every `GET /users/{id}` a bot makes goes through the
 * same cross-bot redis cache, so a lookup one bot already paid for is free for the next one -- and, more to
 * the point, so the bots stop competing with the dashboard for Discord's 30-per-30s `GET /users/{id}` budget.
 *
 * `null` means Discord 404'd the id. Anything else still throws, exactly like a bare `users.get`.
 */
export async function fetchUser(api: API, userId: Snowflake): Promise<APIUser | null> {
	return fetchUserCached(userId, async (id) => {
		try {
			return await api.users.get(id);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 404) {
				return null;
			}

			throw error;
		}
	});
}
