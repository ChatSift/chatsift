import { RedisStore } from '@chatsift/backend-core';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';

/**
 * The profile snapshot behind the user log (P4, feature 34).
 *
 * `GUILD_MEMBER_UPDATE` says what a member looks like *now* and never what they looked like before, so
 * "changed their nickname" needs a previous value from somewhere. This is that somewhere: the last shape we
 * saw, replaced every time we see a new one.
 *
 * The consequence to accept, and legacy accepted it too: **the first change after a cold cache is not logged**,
 * because there is nothing to diff against. It is recorded instead, so the second one is. Members who join
 * after the bot are primed by `GUILD_MEMBER_ADD` (see `profileObserver.ts`); priming from message authors was
 * considered and rejected, because a `MESSAGE_CREATE` member object need not carry `nick` and writing one
 * without it would manufacture false "cleared their nickname" entries.
 */
export interface CachedMemberProfile {
	/**
	 * Discord's display name (`global_name`), which is the one people actually see and the one that did not
	 * exist when legacy tracked only `username`. Null for an account that has never set one.
	 */
	readonly globalName: string | null;
	readonly nick: string | null;
	readonly username: string;
}

const profileRecipe = createRecipe(
	{
		username: DataType.String,
		globalName: DataType.String,
		nick: DataType.String,
	},
	{ versioned: true },
	// Same widening cast every recipe here needs: bin-rw decodes each `DataType.String` as `string | null`,
	// whereas `username` is always present.
) as Recipe<CachedMemberProfile>;

/**
 * Long enough that a member who speaks occasionally stays known between renames, short enough that a guild's
 * entire membership is not held forever for a log almost nobody reads. Slid forward on read is *wrong* here for
 * the same reason it is on the message cache -- nothing reads these except the diff that is about to overwrite
 * them.
 */
export const MEMBER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const store = new RedisStore<CachedMemberProfile>({
	TTL: MEMBER_CACHE_TTL_MS,
	recipe: profileRecipe,
	makeKey: (compoundKey: string) => `automoderator:member:${compoundKey}`,
	refreshTTLOnRead: false,
	storeOld: false,
});

// Guild-scoped because `nick` is: the same account has a different nickname in every server, and a shared entry
// would report every one of them as a rename the moment they spoke somewhere else.
const key = (guildId: string, userId: string): string => `${guildId}:${userId}`;

export async function getCachedMemberProfile(guildId: string, userId: string): Promise<CachedMemberProfile | null> {
	return store.get(key(guildId, userId));
}

export async function cacheMemberProfile(
	guildId: string,
	userId: string,
	profile: CachedMemberProfile,
): Promise<void> {
	await store.set(key(guildId, userId), profile);
}
