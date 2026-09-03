import { fetchUserCached, getContext } from '@chatsift/backend-core';
import { displayAvatarURL } from '@chatsift/core';
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
 * The avatar to draw on an embed this service builds from a database row -- a case log it is rewriting, a
 * report card it is posting (#377). Neither table stores an avatar, so the account has to be resolved.
 *
 * Best-effort by construction, exactly like `services/automoderator-bot`'s twin: the lookup is cache-first, and
 * nothing about it may cost the guild the message it decorates. A rate limit, a dead token or an account
 * Discord no longer knows about all come back `undefined`, which renders an author line with no icon.
 */
export async function resolveAvatarURL(api: API, userId: Snowflake): Promise<string | undefined> {
	try {
		const user = await resolveDiscordUserOrNull(api, userId);
		return user ? displayAvatarURL(user.id, user.avatar) : undefined;
	} catch (error) {
		getContext().logger.warn({ err: error, userId }, 'could not resolve an avatar for an embed');
		return undefined;
	}
}

/**
 * `resolveDiscordUserOrNull` with the bare-snowflake fallback every user-facing route wants: a user Discord
 * can't resolve is still worth rendering as an id rather than failing the whole request over.
 */
export async function resolveDiscordUser(api: API, userId: Snowflake): Promise<APIUser | Snowflake> {
	return (await resolveDiscordUserOrNull(api, userId)) ?? userId;
}

/**
 * What an unauthenticated page is allowed to know about a user: a display name and an avatar. Shared by both
 * unauthenticated surfaces -- AMA's public answers page (#323) and Social's public leaderboard -- because the
 * rule is the surface's, not either product's, and a second copy is a second place for a field to creep back
 * in.
 *
 * Note that this does **not** hide the user's id, and cannot while it returns a Discord CDN avatar URL: those
 * are `/avatars/<userId>/<hash>.png` by construction, so a member with a custom avatar has their snowflake in
 * the `avatarUrl` string. What this guarantees is narrower and worth stating exactly: no id is emitted as its
 * own field, so nothing downstream can key, join, or filter on one, and a member on the default avatar emits
 * no id at all. Actually removing it would mean proxying every avatar through our own domain or dropping
 * avatars from these pages -- both real decisions, neither taken (see docs/roadmap/10-social-port.md).
 *
 * `resolveDiscordUser`'s bare-snowflake fallback (an unresolvable or 404'd user) renders as "Unknown User"
 * with no avatar rather than printing the id it couldn't resolve.
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
