import type { AppealUserState } from '@chatsift/db';
import { getContext } from '../context.js';
import { decrypt, encrypt } from '../crypt.js';

/**
 * `appeal_user_state` (#232 §6, decision 14): what a completed `unban.app` login gives us about the appellant
 * that has to outlive their session, and what we have since learned about reaching them.
 *
 * Keyed by user rather than by (user, guild) because both facts are properties of the person: whether Discord
 * will deliver a DM from this application, and whether they granted `guilds.join`. **Nothing here is ever
 * exposed to a guild's moderators** -- no mod-facing route reads this table, and the card is told only that
 * delivery looks unlikely, never anything else about the account.
 *
 * In `@chatsift/backend-core` rather than in `services/api`, which is where it started: P6 delivers decisions
 * from both mod surfaces, so `services/appeals-bot` reads and writes the same three columns.
 */

export interface AppellantGrant {
	readonly grantedGuildsJoin: boolean;
	/**
	 * Whether the authorization was accepted as a **user install**, which is the entire DM mechanism (§6: there
	 * is no OAuth scope that grants DM permission). Declining it is a supported outcome -- the appeal still
	 * files, it just cannot be delivered -- so it is recorded rather than refused.
	 */
	readonly grantedUserInstall: boolean;
	readonly refreshToken: string;
}

/**
 * Records what a completed login gives us.
 *
 * The refresh token is the point of the table. Approving an appeal can re-add the appellant, and that happens
 * days or weeks after they authorized -- long after the browser session that produced it is gone and the
 * access token from that exchange expired. Encrypted with the same `encrypt`/`decrypt` #216 uses for instance
 * bot tokens.
 *
 * `granted_guilds_join` is read off the scopes Discord actually returned rather than the ones we asked for, so
 * an appellant who trims the scope on the consent screen is recorded as having declined rather than as having
 * agreed -- the difference between an approval that DMs an invite (correct) and one that tries to add them and
 * fails (a decision that silently half-lands).
 *
 * **`dm_reachable` is written here only when a login establishes it**, and a login establishes exactly one
 * thing: an authorization without the user install has no DM path at all, which is a known `false` rather than
 * an untried unknown. With the install granted it goes back to NULL, including over an earlier `false` -- a
 * bounce weeks ago said nothing about whether they have since reopened their DMs, and a login is precisely the
 * moment that could have changed.
 */
export async function recordAppellantGrant(userId: string, grant: AppellantGrant): Promise<void> {
	const reachable = grant.grantedUserInstall ? null : false;

	await getContext().db`
		INSERT INTO appeal_user_state (user_id, granted_guilds_join, refresh_token, dm_reachable, dm_checked_at)
		VALUES (
			${userId},
			${grant.grantedGuildsJoin},
			${encrypt(grant.refreshToken)},
			${reachable},
			${grant.grantedUserInstall ? null : new Date()}
		)
		ON CONFLICT (user_id) DO UPDATE SET
			granted_guilds_join = EXCLUDED.granted_guilds_join,
			refresh_token = EXCLUDED.refresh_token,
			dm_reachable = EXCLUDED.dm_reachable,
			dm_checked_at = EXCLUDED.dm_checked_at,
			updated_at = now()
	`;
}

export async function readAppealUserState(userId: string): Promise<AppealUserState | null> {
	const [row] = await getContext().db<AppealUserState[]>`
		SELECT * FROM appeal_user_state WHERE user_id = ${userId}
	`;

	return row ?? null;
}

/**
 * The appellant's stored `guilds.join` credential, decrypted, or `null` when there is nothing usable.
 *
 * A ciphertext that will not decrypt resolves to `null` rather than throwing: the only ways to get one are an
 * `ENCRYPTION_KEY` rotation and a tampered row, and neither is a reason to fail a decision that has already
 * been committed. The approval falls back to the invite, which is the same path a refusal takes.
 */
export function readRejoinCredential(state: AppealUserState | null): string | null {
	if (!state?.grantedGuildsJoin || !state.refreshToken) {
		return null;
	}

	try {
		return decrypt(state.refreshToken);
	} catch (error) {
		getContext().logger.warn({ err: error, userId: state.userId }, 'could not decrypt an appellant refresh token');
		return null;
	}
}

/**
 * Stores the refresh token Discord hands back when the old one is redeemed.
 *
 * Discord rotates refresh tokens on every exchange and invalidates the one that was presented, so skipping this
 * write means the next approval for this account finds a token that is already dead -- and silently falls back
 * to an invite forever after the first re-add.
 */
export async function recordAppellantRefreshToken(userId: string, refreshToken: string): Promise<void> {
	await getContext().db`
		UPDATE appeal_user_state
		SET refresh_token = ${encrypt(refreshToken)}, updated_at = now()
		WHERE user_id = ${userId}
	`;
}

/**
 * What the last delivery attempt proved about reaching this account.
 *
 * Written from an attempt rather than from a probe, because there is no probe: opening a DM channel succeeds
 * whether or not a message would be accepted, and the only honest test is sending something somebody was owed
 * anyway.
 */
export async function recordDmReachability(userId: string, reachable: boolean): Promise<void> {
	await getContext().db`
		INSERT INTO appeal_user_state (user_id, dm_reachable, dm_checked_at)
		VALUES (${userId}, ${reachable}, now())
		ON CONFLICT (user_id) DO UPDATE SET
			dm_reachable = EXCLUDED.dm_reachable,
			dm_checked_at = EXCLUDED.dm_checked_at,
			updated_at = now()
	`;
}

/**
 * Drops the stored credential once no appeal of theirs can still need it.
 *
 * The token is a live grant against a hostile-by-construction population, held for weeks, and the roadmap's own
 * risk list says to stop holding it the moment the re-add window closes. That moment is "no `PENDING` appeal
 * anywhere" -- only a pending appeal can still be approved, and approval is the only thing that spends the
 * token. Filing another appeal means signing in again, which re-records it before the form even renders.
 *
 * `granted_guilds_join` deliberately survives: it is the record of what they agreed to, not the means of doing
 * it. Everything that acts on the grant goes through {@link readRejoinCredential}, which needs both.
 */
export async function dropSpentRejoinCredential(userId: string): Promise<void> {
	await getContext().db`
		UPDATE appeal_user_state
		SET refresh_token = NULL, updated_at = now()
		WHERE user_id = ${userId}
			AND refresh_token IS NOT NULL
			AND NOT EXISTS (SELECT 1 FROM appeals WHERE user_id = ${userId} AND status = 'PENDING')
	`;
}
