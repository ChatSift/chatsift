import type { Appeals } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { discordAPIAppeals } from '../../../util/discordAPI.js';
import { resolveDiscordUser } from '../../../util/users.js';

/**
 * An appeal as the *moderator's* surfaces see it -- the whole row, including everything
 * `util/appealsPublic.ts` exists to keep away from the appellant: `silent`, `decidedAt`, `decidedById` and
 * `decisionReason`. Nothing here may ever be reached by an `isAppealsAuthed` route; the two session kinds share
 * no middleware precisely so that cannot happen by accident (#232 P3).
 *
 * `modChannelId`/`modMessageId`/`modThreadId` ride along because the detail view links to the card: the appeal
 * has two mod surfaces and each should be one click from the other.
 */
export interface AppealWithUsers extends Appeals {
	/**
	 * Resolved live, because no appeal table stores a username snapshot -- an appellant is banned from the guild
	 * in question and can be resolvable by nothing but their id, which is what the bare-snowflake fallback
	 * renders.
	 */
	appellant: APIUser | Snowflake;
	/**
	 * The moderator who decided it. `null` while pending, and also on the two terminal states nobody decided --
	 * a withdrawal and a `MOOT` close (P4b) both carry no actor by construction.
	 */
	decidedByUser: APIUser | Snowflake | null;
}

/**
 * Every account a page of appeals refers to, so the caller can resolve them in one pass. Exposed separately
 * from {@link resolveAppealUsers} for the detail view, which adds the `appeal_events` trail's actors to the
 * same set: the appellant submitted the appeal and the moderator who decided it wrote that event, so resolving
 * the two sets independently would look up the same two accounts twice.
 */
export function appealUserIds(appeals: readonly Appeals[]): Set<string> {
	const ids = new Set<string>();

	for (const row of appeals) {
		ids.add(row.userId);
		if (row.decidedById) {
			ids.add(row.decidedById);
		}
	}

	return ids;
}

/**
 * One resolved user per distinct id, with `resolveDiscordUser`'s bare-snowflake fallback for an account Discord
 * no longer knows about. Mirrors `reports/util.ts` -- one lookup per *distinct* id, so a queue full of appeals
 * decided by the same moderator costs one fetch, not one per row.
 */
export async function resolveUsersById(ids: ReadonlySet<string>): Promise<Map<string, APIUser | Snowflake>> {
	const entries = await Promise.all(
		[...ids].map(async (id): Promise<[string, APIUser | Snowflake]> => [
			id,
			await resolveDiscordUser(discordAPIAppeals, id),
		]),
	);

	return new Map(entries);
}

export function attachAppealUsers(
	appeals: readonly Appeals[],
	usersById: ReadonlyMap<string, APIUser | Snowflake>,
): AppealWithUsers[] {
	return appeals.map((row) => ({
		...row,
		appellant: usersById.get(row.userId) ?? row.userId,
		decidedByUser: row.decidedById ? (usersById.get(row.decidedById) ?? row.decidedById) : null,
	}));
}

export async function resolveAppealUsers(appeals: readonly Appeals[]): Promise<AppealWithUsers[]> {
	return attachAppealUsers(appeals, await resolveUsersById(appealUserIds(appeals)));
}
