import { fetchUserCached } from '@chatsift/backend-core';
import type { API, APIUser, Snowflake } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';
import { isNotFoundDiscordError } from './discordErrors.js';

/**
 * Every `GET /users/{id}` this service makes goes through here, so they all share one cross-bot redis cache
 * (`@chatsift/backend-core`'s `fetchUserCached`) instead of each route paying its own way against Discord's
 * `GET /users/{id}` bucket -- 30 requests per 30 seconds per token, serialized by `@discordjs/rest`, which a
 * single AMA questions page with a few dozen distinct authors blows straight through.
 *
 * `api` is only consulted on a genuine cache miss. Which token it carries doesn't affect what's cached: the
 * route is a global user lookup, identical for every bot and every custom instance's application.
 *
 * Deliberately *not* used for `GET /users/@me` (`util/me.ts`) -- that's an OAuth-token call returning fields
 * this cache must never hold, and it's already cached per session by `MeStore`.
 *
 * `null` means Discord 404'd the id (deleted account, or never a real user). Anything else -- a rate limit, a
 * 5xx, a dead token -- still throws, same as a bare `users.get` would.
 */
export async function resolveDiscordUserOrNull(api: API, userId: Snowflake): Promise<APIUser | null> {
	return fetchUserCached(userId, async (id) => {
		try {
			return await api.users.get(id);
		} catch (error) {
			if (isNotFoundDiscordError(error)) {
				return null;
			}

			throw error;
		}
	});
}

/**
 * `resolveDiscordUserOrNull` with the bare-snowflake fallback every user-facing route wants: a user Discord
 * can't resolve is still worth rendering as an id rather than failing the whole request over.
 */
export async function resolveDiscordUser(api: API, userId: Snowflake): Promise<APIUser | Snowflake> {
	return (await resolveDiscordUserOrNull(api, userId)) ?? userId;
}

/**
 * What an unauthenticated page is allowed to know about a user: a display name and an avatar, never the raw
 * snowflake. Shared by the two share-token surfaces -- AMA's public answers page (#323) and Social's public
 * leaderboard -- because the rule is the surface's, not either product's, and a second copy is a second place
 * for an id to start leaking.
 *
 * `resolveDiscordUser`'s bare-snowflake fallback (an unresolvable or 404'd user) renders as "Unknown User"
 * with no avatar rather than leaking the id it couldn't resolve.
 */
export interface PublicUserInfo {
	avatarUrl: string | null;
	displayName: string;
}

export function toPublicUserInfo(resolved: APIUser | Snowflake): PublicUserInfo {
	if (typeof resolved === 'string') {
		return { avatarUrl: null, displayName: 'Unknown User' };
	}

	return {
		avatarUrl: resolved.avatar
			? `${RouteBases.cdn}${CDNRoutes.userAvatar(resolved.id, resolved.avatar, ImageFormat.PNG)}`
			: null,
		displayName: resolved.global_name ?? resolved.username,
	};
}
